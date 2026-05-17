const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 10000,
  pingInterval: 5000,
});

app.use(express.static(path.join(__dirname, 'public')));

/* ===================== 常量 ===================== */
const ROLES = {
  werewolf: { name: '狼人', icon: '🐺', color: '#e04040', desc: '每晚与其他狼人一起猎杀一名玩家', team: 'werewolf' },
  villager: { name: '村民', icon: '👨‍🌾', color: '#3cb878', desc: '没有特殊能力，通过推理找出狼人', team: 'villager' },
  seer:     { name: '预言家', icon: '🔮', color: '#4a90d9', desc: '每晚可以查验一名玩家的身份', team: 'villager' },
  witch:    { name: '女巫', icon: '🧪', color: '#a050dc', desc: '拥有一瓶解药和一瓶毒药，各可使用一次', team: 'villager' },
  hunter:   { name: '猎人', icon: '🏹', color: '#d4a843', desc: '被淘汰时可以开枪带走一名玩家', team: 'villager' },
  guard:    { name: '守卫', icon: '🛡️', color: '#3cc8b4', desc: '每晚可以守护一名玩家，不能连续守护同一人', team: 'villager' },
  idiot:    { name: '白痴', icon: '🤪', color: '#ff9800', desc: '被投票出局时可翻牌存活，但失去投票权', team: 'villager' },
  elder:    { name: '长老', icon: '👴', color: '#795548', desc: '有两条命，但被女巫毒杀直接死亡', team: 'villager' },
  cupid:    { name: '丘比特', icon: '💘', color: '#e91e63', desc: '首夜可连接两名玩家为情侣，情侣同生共死', team: 'villager' },
};

const MIN_PLAYERS = 6;
const MAX_PLAYERS = 18;
const VOTE_TIME_MS = 60000; // 白天投票限时60秒
const LAST_WORDS_TIME_MS = 30000; // 遗言时间30秒
const SHERIFF_SPEAK_TIME_MS = 15000; // 警长竞选发言时间15秒

/* ===================== 房间管理 ===================== */
const rooms = new Map(); // roomId -> Room

function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id;
  do {
    id = '';
    for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(id));
  return id;
}

function getRoleConfig(count) {
  if (count === 6)  return { werewolf: 2, villager: 2, seer: 1, witch: 1 };
  if (count === 7)  return { werewolf: 2, villager: 2, seer: 1, witch: 1, hunter: 1 };
  if (count === 8)  return { werewolf: 2, villager: 2, seer: 1, witch: 1, hunter: 1, guard: 1 };
  if (count === 9)  return { werewolf: 3, villager: 2, seer: 1, witch: 1, hunter: 1, guard: 1 };
  if (count === 10) return { werewolf: 3, villager: 3, seer: 1, witch: 1, hunter: 1, guard: 1 };
  if (count === 11) return { werewolf: 3, villager: 3, seer: 1, witch: 1, hunter: 1, guard: 1, extra1: 1 };
  return { werewolf: 4, villager: 3, seer: 1, witch: 1, hunter: 1, guard: 1, extra1: count - 11 };
}

function validateRoleConfig(config, playerCount) {
  if (!config || typeof config !== 'object') return { valid: false, error: '配置格式无效' };

  let total = 0;
  let wolfCount = 0;
  let villagerTeamCount = 0;

  for (const [role, num] of Object.entries(config)) {
    if (!ROLES[role]) return { valid: false, error: `未知角色: ${role}` };
    if (typeof num !== 'number' || num < 0 || !Number.isInteger(num)) return { valid: false, error: `${ROLES[role].name} 数量无效` };
    total += num;
    if (role === 'werewolf') wolfCount += num;
    else villagerTeamCount += num;
  }

  if (wolfCount < 1) return { valid: false, error: '至少需要1名狼人' };
  if (villagerTeamCount < 1) return { valid: false, error: '至少需要1名好人阵营角色' };
  if (total !== playerCount) return { valid: false, error: `角色总数(${total})与玩家数(${playerCount})不匹配` };

  return { valid: true };
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ===================== Room 类 ===================== */
class Room {
  constructor(roomId, hostSocketId, hostName) {
    this.roomId = roomId;
    this.hostSocketId = hostSocketId;
    this.phase = 'lobby';
    this.players = []; // { socketId, name, role, alive, gender, revealed, disconnected }
    this.round = 0;
    this.logs = [];
    this.chatHistory = []; // 狼人聊天历史
    this.createdAt = Date.now();
    this.password = null; // 房间密码，null表示无密码

    // 夜间状态
    this.nightKill = null;
    this.witchSaveUsed = false;
    this.witchPoisonUsed = false;
    this.witchSaveTarget = null;
    this.witchPoisonTarget = null;
    this.guardTarget = null;
    this.lastGuardTarget = null;
    this.votes = {}; // { voterId: targetId } (白天投票)
    this.wwVotes = {}; // { wolfSocketId: targetId } (狼人投票)
    this.seerResult = null; // { targetId, result }
    this.eliminatedTonight = [];
    this.hunterPending = null; // socketId
    this.winner = null;
    this._voteTally = null;
    this._pendingElimination = null;

    // 旁白
    this.narrationEnabled = true;

    // 角色配置
    this.roleConfig = null; // null = 使用默认配置

    // 计时器
    this.voteTimer = null;
    this.phaseTimer = null;

    // 遗言状态
    this.lastWordsPlayer = null; // socketId of player giving last words
    this.lastWordsChat = []; // { from, msg, time }
    this.lastWordsTimer = null;

    // 警长系统
    this.sheriffId = null; // 警长 socketId
    this.sheriffCandidates = []; // 竞选者 socketId 列表
    this.sheriffVotes = {}; // { voterId: candidateId }
    this.sheriffSpeakIdx = 0; // 当前发言的竞选者索引
    this.sheriffTimer = null;
    this.sheriffElectionDone = false; // 首日是否已选举过警长

    // 游戏回放
    this.replayData = []; // 回放数据：{ time, phase, event, data }
    this.gameStartTime = null;

    // 观战模式
    this.spectators = []; // { socketId, name }
    this.maxSpectators = 5; // 最大观战人数
  }

  addPlayer(socketId, name) {
    const gender = Math.random() > 0.5 ? 'male' : 'female';
    this.players.push({ socketId, name, role: null, alive: true, gender, revealed: false, disconnected: false });
    this.broadcastState();
    this.broadcastPersonal();
  }

  removePlayer(socketId) {
    const idx = this.players.findIndex(p => p.socketId === socketId);
    if (idx === -1) return;
    const p = this.players[idx];

    if (this.phase === 'lobby') {
      this.players.splice(idx, 1);
      if (p.socketId === this.hostSocketId && this.players.length > 0) {
        this.hostSocketId = this.players[0].socketId;
      }
    } else {
      // 游戏中标记为断线，角色保留
      p.disconnected = true;
      p.alive = false;
      this.log(`${p.name} 断开连接，角色出局`);
      const gameOver = this.checkGameOver();
      if (!gameOver) this.autoSkipIfNeeded(socketId);
    }
    this.broadcastState();
    this.broadcastPersonal();
  }

  /* ===================== 观战系统 ===================== */
  addSpectator(socketId, name) {
    if (this.spectators.length >= this.maxSpectators) return false;
    if (this.spectators.some(s => s.socketId === socketId)) return false;
    this.spectators.push({ socketId, name });
    this.broadcastState();
    return true;
  }

  removeSpectator(socketId) {
    const idx = this.spectators.findIndex(s => s.socketId === socketId);
    if (idx === -1) return;
    this.spectators.splice(idx, 1);
    this.broadcastState();
  }

  isSpectator(socketId) {
    return this.spectators.some(s => s.socketId === socketId);
  }

  getSpectatorState() {
    // 观战者看不到夜间信息（狼人聊天、查验结果等）
    const state = this.getClientState();
    // 隐藏敏感信息
    state.nightKill = null;
    state.seerResult = null;
    state.wwVotes = {};
    state.wwVoteTally = {};
    state.witchSaveUsed = this.witchSaveUsed;
    state.witchPoisonUsed = this.witchPoisonUsed;
    state.spectators = this.spectators.map(s => ({ name: s.name }));
    return state;
  }

  autoSkipIfNeeded(disconnectedSocketId) {
    // 角色揭示阶段：如果所有人都已揭示或离线
    if (this.phase === 'role-reveal' && this.players.every(p => p.revealed || p.disconnected)) {
      this.phase = 'night-werewolf';
      this.log('🌑 夜晚降临，狼人请行动', 'system');
      return;
    }
    // 狼人阶段：如果断线的是狼人，检查是否还能继续
    if (this.phase === 'night-werewolf') {
      const wolves = this.getAliveWerewolves();
      if (wolves.length === 0) return; // 游戏已结束
      if (wolves.every(w => this.wwVotes[w.socketId])) {
        const targets = Object.values(this.wwVotes);
        const allSame = targets.every(t => t === targets[0]);
        if (allSame) {
          this.nightKill = targets[0];
          this.log(`狼人一致决定猎杀 ${this.players.find(pl => pl.socketId === this.nightKill)?.name}`, 'kill');
          this.phase = 'night-seer';
        }
      }
      return;
    }
    // 预言家阶段：如果预言家离线
    if (this.phase === 'night-seer') {
      const seer = this.players.find(p => p.alive && p.role === 'seer' && !p.disconnected);
      if (!seer) {
        this.phase = 'night-witch';
      }
      return;
    }
    // 女巫阶段：如果女巫离线
    if (this.phase === 'night-witch') {
      const witch = this.players.find(p => p.alive && p.role === 'witch' && !p.disconnected);
      if (!witch) {
        this.phase = 'night-guard';
      }
      return;
    }
    // 守卫阶段：如果守卫离线
    if (this.phase === 'night-guard') {
      const guard = this.players.find(p => p.alive && p.role === 'guard' && !p.disconnected);
      if (!guard) {
        this.endNightPhase();
      }
      return;
    }
    // 猎人开枪阶段
    if (this.phase === 'hunter-shoot' && this.hunterPending === disconnectedSocketId) {
      this.hunterPending = null;
      if (this.checkGameOver()) return;
      const wasNight = this.eliminatedTonight.some(e => e.hunterActive);
      if (wasNight) {
        this.phase = 'day';
        this.log('☀️ 天亮了，进入讨论和投票阶段', 'system');
      } else {
        this.startNewRound();
        return;
      }
    }
  }

  getAlivePlayers() { return this.players.filter(p => p.alive && !p.disconnected); }
  getAliveWerewolves() { return this.getAlivePlayers().filter(p => p.role === 'werewolf'); }
  getWerewolves() { return this.players.filter(p => p.role === 'werewolf' && !p.disconnected); }
  getVillagerTeam() { return this.getAlivePlayers().filter(p => ROLES[p.role]?.team === 'villager'); }
  getPlayer(socketId) { return this.players.find(p => p.socketId === socketId); }

  log(msg, type = 'system') {
    this.logs.push({ msg, type, time: Date.now() });
    if (this.logs.length > 100) this.logs.shift();
  }

  recordReplay(event, data = {}) {
    this.replayData.push({
      time: Date.now() - (this.gameStartTime || Date.now()),
      phase: this.phase,
      round: this.round,
      event,
      data
    });
  }

  getReplay() {
    return {
      roomId: this.roomId,
      startTime: this.gameStartTime,
      endTime: Date.now(),
      duration: Date.now() - (this.gameStartTime || Date.now()),
      players: this.players.map(p => ({ name: p.name, role: p.role, alive: p.alive })),
      winner: this.winner,
      rounds: this.round,
      replayData: this.replayData,
    };
  }

  narrate(msg) {
    if (!this.narrationEnabled) return;
    io.to(this.roomId).emit('narration', { msg, time: Date.now() });
  }

  broadcastState() {
    const room = this;
    io.to(this.roomId).emit('state', room.getClientState());
  }

  // 返回给客户端的状态（过滤敏感信息）
  getClientState() {
    const aliveIds = new Set(this.getAlivePlayers().map(p => p.socketId));
    return {
      roomId: this.roomId,
      hostSocketId: this.hostSocketId,
      phase: this.phase,
      round: this.round,
      logs: this.logs.slice(-20),
      players: this.players.map(p => ({
        socketId: p.socketId,
        name: p.name,
        alive: p.alive,
        gender: p.gender,
        disconnected: p.disconnected,
        // 角色信息：只有自己、死亡的玩家、游戏结束时才显示
        role: (p.alive && this.phase !== 'gameover') ? null : p.role,
        revealed: p.revealed,
      })),
      winner: this.winner,
      // 夜间/白天状态
      nightKill: this.nightKill,
      witchSaveUsed: this.witchSaveUsed,
      witchPoisonUsed: this.witchPoisonUsed,
      guardTarget: this.guardTarget,
      lastGuardTarget: this.lastGuardTarget,
      votes: this.votes,
      wwVoteTally: Object.values(this.wwVotes).reduce((acc, targetId) => {
        acc[targetId] = (acc[targetId] || 0) + 1;
        return acc;
      }, {}),
      eliminatedTonight: this.eliminatedTonight,
      hunterPending: this.hunterPending,
      voteTimeLeft: this.voteTimeLeft,
      _voteTally: this._voteTally,
      _pendingElimination: this._pendingElimination,
      teamCounts: {
        werewolves: this.getAliveWerewolves().length,
        villagers: this.getVillagerTeam().length,
      },
      narrationEnabled: this.narrationEnabled,
      roleConfig: this.roleConfig,
      hasPassword: !!this.password,
      lastWordsPlayer: this.lastWordsPlayer,
      // 警长系统
      sheriffId: this.sheriffId,
      sheriffCandidates: this.sheriffCandidates,
      sheriffVotes: this.sheriffVotes,
      sheriffSpeakIdx: this.sheriffSpeakIdx,
      sheriffElectionDone: this.sheriffElectionDone,
      // 观战系统
      spectators: this.spectators.map(s => ({ name: s.name })),
      spectatorCount: this.spectators.length,
    };
  }

  getPersonalState(socketId) {
    const player = this.getPlayer(socketId);
    if (!player) return {};
    const roleInfo = player.role ? {
      ...ROLES[player.role],
      teammates: player.role === 'werewolf'
        ? this.getWerewolves().filter(w => w.socketId !== socketId).map(w => ({ name: w.name, alive: w.alive, socketId: w.socketId }))
        : undefined,
    } : null;

    return {
      mySocketId: socketId,
      myRole: player.role,
      myRoleInfo: roleInfo,
      myAlive: player.alive,
      canAct: this.canPlayerAct(socketId),
      myWwVote: this.wwVotes[socketId] || null,
      myVote: this.votes[socketId] || null,
      mySeerCheck: player.role === 'seer' ? this.seerResult : null,
    };
  }

  canPlayerAct(socketId) {
    const p = this.getPlayer(socketId);
    if (!p || !p.alive || p.disconnected) return false;
    switch (this.phase) {
      case 'night-werewolf': return p.role === 'werewolf';
      case 'night-seer': return p.role === 'seer';
      case 'night-witch': return p.role === 'witch';
      case 'night-guard': return p.role === 'guard';
      case 'hunter-shoot': return this.hunterPending === socketId;
      case 'vote': return p.alive && !this.votes[socketId];
      default: return false;
    }
  }

  broadcastPersonal() {
    for (const p of this.players) {
      const ps = this.getPersonalState(p.socketId);
      io.to(p.socketId).emit('personal', ps);
    }
  }

  /* ===================== 游戏流程 ===================== */

  startGame() {
    const count = this.players.length;
    if (count < MIN_PLAYERS) return false;

    const config = this.roleConfig || getRoleConfig(count);
    let roleList = [];
    for (const [role, num] of Object.entries(config)) {
      const roleKey = role === 'extra1' ? 'villager' : role;
      for (let i = 0; i < num; i++) roleList.push(roleKey);
    }
    shuffle(roleList);

    this.players.forEach((p, i) => {
      p.role = roleList[i];
      p.alive = true;
      p.revealed = false;
      p.disconnected = false;
    });

    this.round = 1;
    this.logs = [];
    this.chatHistory = [];
    this.resetNightState();
    this.phase = 'role-reveal';

    // 初始化回放数据
    this.gameStartTime = Date.now();
    this.replayData = [];
    this.recordReplay('game-start', {
      players: this.players.map(p => ({ name: p.name, role: p.role })),
      config
    });

    this.log('角色已分配，请大家查看身份！', 'system');
    this.narrate(`游戏开始！共 ${count} 名玩家，角色已分配，请查看身份。`);
    this.broadcastState();
    this.broadcastPersonal();
    return true;
  }

  resetNightState() {
    this.nightKill = null;
    this.witchSaveTarget = null;
    this.witchPoisonTarget = null;
    this.guardTarget = null;
    this.votes = {};
    this.wwVotes = {};
    this.seerResult = null;
    this.eliminatedTonight = [];
    this.hunterPending = null;
    this.voteTimeLeft = null;
    if (this.voteTimer) { this.voteTimer.clear(); this.voteTimer = null; }
    if (this.phaseTimer) { this.phaseTimer.clear(); this.phaseTimer = null; }
  }

  confirmReveal(socketId) {
    const p = this.getPlayer(socketId);
    if (p) p.revealed = true;
    if (this.players.every(p => p.revealed || p.disconnected)) {
      this.phase = 'night-werewolf';
      this.log('🌑 夜晚降临，狼人请行动', 'system');
      this.narrate('所有玩家已确认身份。夜幕降临，狼人开始行动...');
    }
    this.broadcastState();
    this.broadcastPersonal();
  }

  /* ---------- 狼人阶段 ---------- */
  wwVote(socketId, targetId) {
    if (this.phase !== 'night-werewolf') return;
    const p = this.getPlayer(socketId);
    if (!p || p.role !== 'werewolf' || !p.alive) return;
    const target = this.players.find(pl => pl.socketId === targetId);
    if (!target || target.role === 'werewolf') return;
    this.wwVotes[socketId] = targetId;
    this.log(`${p.name} 提议猎杀 ${target.name}`, 'kill');
    this.broadcastState();

    // 如果所有狼人都投了同一个目标，自动确认
    const wolves = this.getAliveWerewolves();
    if (wolves.length > 0 && wolves.every(w => this.wwVotes[w.socketId])) {
      const targets = Object.values(this.wwVotes);
      const allSame = targets.every(t => t === targets[0]);
      if (allSame) {
        this.nightKill = targets[0];
        const killName = this.players.find(pl => pl.socketId === this.nightKill)?.name;
        this.log(`狼人一致决定猎杀 ${killName}`, 'kill');
        this.recordReplay('werewolf-kill', { target: killName });
        this.narrate(`狼人已达成一致，选定了今夜的猎物。`);
        this.phase = 'night-seer';
        this.broadcastState();
        this.broadcastPersonal();
      }
    }
  }

  wwConfirmKill(socketId, targetId) {
    if (this.phase !== 'night-werewolf') return;
    const p = this.getPlayer(socketId);
    if (!p || p.role !== 'werewolf') return;
    const target = this.players.find(pl => pl.socketId === targetId);
    if (!target || target.role === 'werewolf') return;
    this.nightKill = targetId;
    this.log(`狼人决定猎杀 ${target.name}`, 'kill');
    this.narrate(`狼人选定了今夜的猎杀目标。预言家，请睁眼...`);
    this.phase = 'night-seer';
    this.broadcastState();
    this.broadcastPersonal();
  }

  wwChat(socketId, message) {
    const p = this.getPlayer(socketId);
    if (!p || p.role !== 'werewolf' || !p.alive) return;
    this.chatHistory.push({ from: p.name, msg: message, time: Date.now() });
    // 只广播给狼人
    const wolves = this.getWerewolves();
    const payload = { from: p.name, msg: message, time: Date.now() };
    for (const w of wolves) {
      io.to(w.socketId).emit('ww-chat', payload);
    }
  }

  /* ---------- 预言家 ---------- */
  seerCheck(socketId, targetId) {
    if (this.phase !== 'night-seer') return;
    const p = this.getPlayer(socketId);
    if (!p || p.role !== 'seer' || !p.alive) return;
    const target = this.players.find(pl => pl.socketId === targetId);
    if (!target || target.socketId === socketId) return;
    const isWolf = target.role === 'werewolf';
    this.seerResult = { targetId, result: isWolf ? 'werewolf' : 'good' };
    this.log(`预言家查验了 ${target.name}`, 'check');
    this.recordReplay('seer-check', { target: target.name, result: isWolf ? 'werewolf' : 'good' });
    this.narrate('预言家完成查验，洞察了一人的身份。女巫，请睁眼...');
    this.broadcastState();
    this.broadcastPersonal();

    // 预言家看完后自动进入女巫
    setTimeout(() => {
      if (this.phase === 'night-seer') {
        this.phase = 'night-witch';
        this.broadcastState();
        this.broadcastPersonal();
      }
    }, 3000);
  }

  /* ---------- 女巫 ---------- */
  witchAction(socketId, { save, poisonTargetId }) {
    if (this.phase !== 'night-witch') return;
    const p = this.getPlayer(socketId);
    if (!p || p.role !== 'witch' || !p.alive) return;

    if (save && !this.witchSaveUsed && this.nightKill && this.nightKill !== p.socketId) {
      this.witchSaveTarget = this.nightKill;
    }
    if (poisonTargetId && !this.witchPoisonUsed) {
      const target = this.players.find(pl => pl.socketId === poisonTargetId);
      if (target && target.socketId !== socketId) {
        this.witchPoisonTarget = poisonTargetId;
      }
    }
    this.log(`女巫使用了技能`, 'info');
    this.recordReplay('witch-action', { save: !!this.witchSaveTarget, poison: !!this.witchPoisonTarget });
    this.narrate('女巫做出抉择，守卫请睁眼...');
    this.phase = 'night-guard';
    this.broadcastState();
    this.broadcastPersonal();
  }

  /* ---------- 守卫 ---------- */
  guardAction(socketId, targetId) {
    if (this.phase !== 'night-guard') return;
    const p = this.getPlayer(socketId);
    if (!p || p.role !== 'guard' || !p.alive) return;
    if (targetId) {
      if (targetId === this.lastGuardTarget) return; // 不能连续守护
      const target = this.players.find(pl => pl.socketId === targetId);
      if (!target) return;
      this.guardTarget = targetId;
      this.log(`守卫守护了 ${target.name}`, 'save');
      this.recordReplay('guard-action', { target: target.name });
      this.narrate('守卫完成守护，所有人闭眼。天即将亮...');
    } else {
      this.recordReplay('guard-action', { target: null });
      this.narrate('守卫选择不守护任何人。天即将亮...');
    }
    this.endNightPhase();
  }

  /* ---------- 夜晚结算 ---------- */
  endNightPhase() {
    this.eliminatedTonight = [];

    const guardTarget = this.guardTarget;
    const killTarget = this.nightKill;
    const saveTarget = this.witchSaveTarget;
    const poisonTarget = this.witchPoisonTarget;

    let actualKill = killTarget;
    if (killTarget && guardTarget === killTarget) {
      actualKill = null;
      this.log('🛡️ 守卫成功守护了被狼人猎杀的玩家！', 'save');
    }
    if (saveTarget && actualKill === saveTarget) {
      actualKill = null;
      this.witchSaveUsed = true;
      this.log('🧪 女巫使用解药救活了被猎杀的玩家！', 'save');
    }
    if (killTarget && guardTarget === killTarget && saveTarget === killTarget) {
      this.log('守卫和女巫同时保护了同一人，平安无事', 'save');
    }

    if (actualKill) {
      const result = this.killPlayer(actualKill, 'werewolf');
      if (result === 'hunter_dying') {
        this.eliminatedTonight.push({ id: actualKill, hunterActive: true });
      } else {
        this.eliminatedTonight.push({ id: actualKill });
      }
    } else {
      this.log('今夜是平安夜 🌙', 'save');
    }

    // 记录夜晚结算回放
    const nightResult = {
      killed: this.eliminatedTonight.map(e => this.players.find(p => p.socketId === e.id)?.name).filter(Boolean),
      saved: !!saveTarget,
      guarded: !!guardTarget,
      poisioned: !!poisonTarget ? this.players.find(p => p.socketId === poisonTarget)?.name : null,
    };
    this.recordReplay('night-result', nightResult);

    // 旁白：夜晚结算摘要
    if (this.eliminatedTonight.length > 0) {
      const names = this.eliminatedTonight.map(e => this.players.find(p => p.socketId === e.id)?.name).filter(Boolean);
      this.narrate(`天亮了。昨夜 ${names.join('、')} 不幸遇害，村庄陷入悲痛。`);
    } else {
      this.narrate('天亮了。昨夜平安无事，无人死亡。');
    }

    if (poisonTarget) {
      this.witchPoisonUsed = true;
      const target = this.players.find(pl => pl.socketId === poisonTarget);
      if (target && target.alive) {
        const result = this.killPlayer(poisonTarget, 'poison');
        if (result === 'hunter_dying') {
          this.eliminatedTonight.push({ id: poisonTarget, hunterActive: true });
        } else {
          this.eliminatedTonight.push({ id: poisonTarget });
        }
      }
    }

    this.lastGuardTarget = this.guardTarget;

    if (this.hunterPending) {
      this.phase = 'hunter-shoot';
      this.broadcastState();
      this.broadcastPersonal();
      return;
    }

    if (this.checkGameOver()) return;

    // 第一天进入警长选举阶段
    if (this.round === 1 && !this.sheriffElectionDone) {
      this.startSheriffElection();
    } else {
      this.phase = 'day';
      this.log('☀️ 天亮了，进入讨论和投票阶段', 'system');
    }

    this.broadcastState();
    this.broadcastPersonal();
  }

  killPlayer(socketId, cause) {
    const p = this.players.find(pl => pl.socketId === socketId);
    if (!p || !p.alive) return false;

    // 白痴被投票出局时翻牌存活
    if (p.role === 'idiot' && cause === 'vote' && !p.revealed) {
      p.revealed = true;
      p.canVote = false;
      this.log(`${p.name} 是白痴，翻牌存活但失去投票权`, 'info');
      this.narrate(`${p.name} 被放逐，但亮出白痴身份，免于死亡！`);
      return 'idiot_survived';
    }

    // 长老有两条命（被毒杀除外）
    if (p.role === 'elder' && cause !== 'poison' && !p.elderUsed) {
      p.elderUsed = true;
      this.log(`${p.name} 是长老，第一次死亡免伤`, 'info');
      this.narrate(`${p.name} 受到致命伤害，但长老身份保护了他！`);
      return 'elder_survived';
    }

    p.alive = false;
    const causeText = cause === 'vote' ? '被投票放逐' : cause === 'poison' ? '被女巫毒杀' : cause === 'hunter' ? '被猎人开枪带走' : '被狼人猎杀';
    this.log(`${p.name} ${causeText}`, 'kill');

    // 警长死亡，需要处理警徽
    if (this.sheriffId === socketId) {
      this.handleSheriffDeath(socketId);
      if (p.role === 'hunter' && cause !== 'hunter') {
        this.hunterPending = p.socketId;
        this.log(`${p.name} 是猎人，技能发动！`, 'info');
        return 'hunter_dying';
      }
      return 'sheriff_dying';
    }

    if (p.role === 'hunter' && cause !== 'hunter') {
      this.hunterPending = p.socketId;
      this.log(`${p.name} 是猎人，技能发动！`, 'info');
      return 'hunter_dying';
    }
    return true;
  }

  /* ---------- 猎人开枪 ---------- */
  hunterShoot(socketId, targetId) {
    if (this.phase !== 'hunter-shoot' || this.hunterPending !== socketId) return;
    if (targetId && targetId !== 'skip') {
      const target = this.players.find(pl => pl.socketId === targetId);
      if (target && target.alive) {
        this.killPlayer(targetId, 'hunter');
        this.log(`猎人开枪带走了 ${target.name}`, 'kill');
        this.narrate(`猎人临死前开枪，带走了 ${target.name}！`);
      }
    } else {
      this.log('猎人选择不开枪', 'info');
      this.narrate('猎人选择不开枪，安静地离去。');
    }
    this.hunterPending = null;

    if (this.checkGameOver()) return;

    // 判断是夜间死亡触发的还是白天死亡触发的
    const wasNight = this.eliminatedTonight.some(e => e.hunterActive);
    if (wasNight && this.phase === 'hunter-shoot') {
      // 夜间死亡触发，进入白天
      this.phase = 'day';
      this.log('☀️ 天亮了，进入讨论和投票阶段', 'system');
    } else {
      // 白天死亡触发，进入下一轮夜晚
      this.startNewRound();
      return;
    }
    this.broadcastState();
    this.broadcastPersonal();
  }

  /* ---------- 白天投票 ---------- */
  startVote() {
    if (this.phase !== 'day') return;
    this.phase = 'vote';
    this.votes = {};
    const alive = this.getAlivePlayers();
    this.voteTimeLeft = VOTE_TIME_MS;
    this.narrate(`投票开始！${alive.length} 名存活玩家，请在60秒内投出你的一票。`);
    this.broadcastState();
    this.broadcastPersonal();

    // 倒计时
    let remaining = VOTE_TIME_MS;
    const interval = setInterval(() => {
      remaining -= 1000;
      this.voteTimeLeft = Math.max(0, remaining);
      io.to(this.roomId).emit('vote-tick', this.voteTimeLeft);
      if (remaining <= 0) {
        clearInterval(interval);
        this.endVote();
      }
    }, 1000);
    this.voteTimer = { clear: () => clearInterval(interval) };
  }

  castVote(socketId, targetId) {
    if (this.phase !== 'vote') return;
    const p = this.getPlayer(socketId);
    if (!p || !p.alive) return;
    if (targetId === socketId) return; // 不能投自己
    const target = this.players.find(pl => pl.socketId === targetId);
    if (!target || !target.alive) return;
    this.votes[socketId] = targetId;
    this.log(`${p.name} 已投票`, 'vote');
    this.broadcastState();

    // 所有人都投完了，提前结束
    const alive = this.getAlivePlayers();
    if (Object.keys(this.votes).length >= alive.length) {
      if (this.voteTimer) this.voteTimer.clear();
      this.endVote();
    }
  }

  endVote() {
    if (this.phase !== 'vote') return;
    this.phase = 'tally';
    this.voteTimeLeft = 0;

    const tally = {};
    for (const [voterId, targetId] of Object.entries(this.votes)) {
      // 警长投票算1.5票
      const weight = voterId === this.sheriffId ? 1.5 : 1;
      tally[targetId] = (tally[targetId] || 0) + weight;
    }

    let maxVotes = 0, topCandidates = [];
    for (const [pid, cnt] of Object.entries(tally)) {
      if (cnt > maxVotes) { maxVotes = cnt; topCandidates = [pid]; }
      else if (cnt === maxVotes) topCandidates.push(pid);
    }

    let eliminatedId = null;
    if (maxVotes > 0 && topCandidates.length === 1) {
      eliminatedId = topCandidates[0];
      const ep = this.players.find(pl => pl.socketId === eliminatedId);
      this.log(`${ep.name} 被投票放逐 (${maxVotes}票)`, 'vote');
      this.recordReplay('vote-result', { eliminated: ep.name, votes: maxVotes, tally });
      this.narrate(`投票结束！${ep.name} 以 ${maxVotes} 票被放逐。`);
    } else {
      this.log(topCandidates.length > 1 ? '平票！无人被放逐' : '无人投票，无人被放逐', 'vote');
      this.recordReplay('vote-result', { eliminated: null, tally });
      this.narrate(topCandidates.length > 1 ? '投票结束！出现平票，本轮无人被放逐。' : '投票结束！无人投票，本轮无人被放逐。');
    }

    this._pendingElimination = eliminatedId;
    this._voteTally = tally;

    // 如果有人被放逐，进入遗言阶段
    if (eliminatedId) {
      this.startLastWords(eliminatedId);
    } else {
      this.broadcastState();
      this.broadcastPersonal();
    }
  }

  startLastWords(playerId) {
    this.phase = 'last-words';
    this.lastWordsPlayer = playerId;
    this.lastWordsChat = [];
    const ep = this.players.find(p => p.socketId === playerId);
    this.log(`${ep?.name} 开始发表遗言`, 'info');
    this.narrate(`${ep?.name} 被放逐了，可以发表最后的遗言...`);
    this.broadcastState();
    this.broadcastPersonal();

    // 遗言倒计时
    let remaining = LAST_WORDS_TIME_MS;
    this.lastWordsTimer = setInterval(() => {
      remaining -= 1000;
      io.to(this.roomId).emit('last-words-tick', remaining);
      if (remaining <= 0) {
        this.endLastWords();
      }
    }, 1000);
  }

  sendLastWords(socketId, message) {
    if (this.phase !== 'last-words') return;
    if (socketId !== this.lastWordsPlayer) return;
    const p = this.getPlayer(socketId);
    if (!p) return;

    const payload = { from: p.name, msg: message, time: Date.now() };
    this.lastWordsChat.push(payload);
    io.to(this.roomId).emit('last-words-msg', payload);
  }

  endLastWords() {
    if (this.lastWordsTimer) {
      clearInterval(this.lastWordsTimer);
      this.lastWordsTimer = null;
    }
    this.lastWordsPlayer = null;
    this.lastWordsChat = [];
    this.afterVoteResult();
  }

  /* ===================== 警长选举 ===================== */
  startSheriffElection() {
    this.phase = 'sheriff-nominate';
    this.sheriffCandidates = [];
    this.sheriffVotes = {};
    this.sheriffSpeakIdx = 0;
    const alive = this.getAlivePlayers();
    this.log('⭐ 天亮了！现在开始警长竞选', 'system');
    this.narrate('天亮了！今天将选举警长，请有意竞选的玩家举手报名。');
  }

  nominateSheriff(socketId) {
    if (this.phase !== 'sheriff-nominate') return;
    const p = this.getPlayer(socketId);
    if (!p || !p.alive || p.disconnected) return;
    if (this.sheriffCandidates.includes(socketId)) return;
    this.sheriffCandidates.push(socketId);
    this.log(`${p.name} 报名竞选警长`, 'info');
    this.broadcastState();
  }

  endNomination() {
    if (this.phase !== 'sheriff-nominate') return;
    if (this.sheriffCandidates.length === 0) {
      this.log('无人竞选警长，跳过选举', 'info');
      this.narrate('无人竞选警长，跳过选举。');
      this.sheriffElectionDone = true;
      this.phase = 'day';
      this.broadcastState();
      this.broadcastPersonal();
      return;
    }
    if (this.sheriffCandidates.length === 1) {
      this.sheriffId = this.sheriffCandidates[0];
      const sheriff = this.getPlayer(this.sheriffId);
      this.log(`${sheriff.name} 当选警长（唯一竞选者）`, 'info');
      this.narrate(`${sheriff.name} 当选为警长！`);
      this.sheriffElectionDone = true;
      this.phase = 'day';
      this.broadcastState();
      this.broadcastPersonal();
      return;
    }
    this.phase = 'sheriff-speak';
    this.sheriffSpeakIdx = 0;
    this.startSheriffSpeak();
  }

  startSheriffSpeak() {
    const candidateId = this.sheriffCandidates[this.sheriffSpeakIdx];
    const p = this.getPlayer(candidateId);
    this.narrate(`请 ${p.name} 发表竞选演讲（15秒）`);
    this.broadcastState();
    this.broadcastPersonal();

    // 发言计时
    let remaining = SHERIFF_SPEAK_TIME_MS;
    this.sheriffTimer = setInterval(() => {
      remaining -= 1000;
      io.to(this.roomId).emit('sheriff-tick', remaining);
      if (remaining <= 0) {
        this.nextSheriffSpeak();
      }
    }, 1000);
  }

  nextSheriffSpeak() {
    if (this.sheriffTimer) {
      clearInterval(this.sheriffTimer);
      this.sheriffTimer = null;
    }
    this.sheriffSpeakIdx++;
    if (this.sheriffSpeakIdx >= this.sheriffCandidates.length) {
      // 所有竞选者发言完毕，进入投票
      this.phase = 'sheriff-vote';
      this.sheriffVotes = {};
      this.narrate('所有竞选者发言完毕，开始投票选举警长！');
    } else {
      this.startSheriffSpeak();
    }
    this.broadcastState();
    this.broadcastPersonal();
  }

  voteSheriff(socketId, candidateId) {
    if (this.phase !== 'sheriff-vote') return;
    const p = this.getPlayer(socketId);
    if (!p || !p.alive || p.disconnected) return;
    if (!this.sheriffCandidates.includes(candidateId)) return;
    this.sheriffVotes[socketId] = candidateId;
    this.broadcastState();

    // 检查是否所有人都投了票
    const alive = this.getAlivePlayers();
    const voters = alive.filter(pl => !this.sheriffCandidates.includes(pl.socketId));
    if (Object.keys(this.sheriffVotes).length >= voters.length) {
      this.endSheriffVote();
    }
  }

  endSheriffVote() {
    if (this.sheriffTimer) {
      clearInterval(this.sheriffTimer);
      this.sheriffTimer = null;
    }

    const tally = {};
    for (const [, candidateId] of Object.entries(this.sheriffVotes)) {
      tally[candidateId] = (tally[candidateId] || 0) + 1;
    }

    let maxVotes = 0, topCandidates = [];
    for (const [cid, cnt] of Object.entries(tally)) {
      if (cnt > maxVotes) { maxVotes = cnt; topCandidates = [cid]; }
      else if (cnt === maxVotes) topCandidates.push(cid);
    }

    if (topCandidates.length === 1) {
      this.sheriffId = topCandidates[0];
      const sheriff = this.getPlayer(this.sheriffId);
      this.log(`${sheriff.name} 当选警长（${maxVotes}票）`, 'info');
      this.narrate(`投票结束！${sheriff.name} 以 ${maxVotes} 票当选为警长！`);
    } else {
      // 平票，随机选一个
      const randomIdx = Math.floor(Math.random() * topCandidates.length);
      this.sheriffId = topCandidates[randomIdx];
      const sheriff = this.getPlayer(this.sheriffId);
      this.log(`${sheriff.name} 当选警长（平票随机）`, 'info');
      this.narrate(`出现平票！${sheriff.name} 随机当选为警长！`);
    }

    this.sheriffElectionDone = true;
    this.phase = 'day';
    this.broadcastState();
    this.broadcastPersonal();
  }

  skipSheriffElection() {
    if (this.phase !== 'sheriff-nominate') return;
    this.log('跳过警长选举', 'info');
    this.narrate('跳过警长选举。');
    this.sheriffElectionDone = true;
    this.phase = 'day';
    this.broadcastState();
    this.broadcastPersonal();
  }

  handleSheriffDeath(socketId) {
    if (this.sheriffId !== socketId) return;
    const p = this.getPlayer(socketId);
    if (!p) return;

    // 警长死亡，需要移交警徽或撕毁
    this.phase = 'sheriff-transfer';
    this.narrate(`${p.name} 是警长，需要处理警徽...`);
    this.broadcastState();
    this.broadcastPersonal();
  }

  transferSheriff(targetId) {
    if (this.phase !== 'sheriff-transfer') return;
    if (targetId === 'destroy') {
      this.log('警徽被撕毁', 'info');
      this.narrate('警徽被撕毁，不再有警长。');
      this.sheriffId = null;
    } else {
      const target = this.getPlayer(targetId);
      if (target && target.alive) {
        this.sheriffId = targetId;
        this.log(`警徽移交给 ${target.name}`, 'info');
        this.narrate(`警徽移交给 ${target.name}！`);
      }
    }
    this.afterSheriffTransfer();
  }

  afterSheriffTransfer() {
    // 判断是夜间死亡还是白天死亡
    const wasNight = this.eliminatedTonight.some(e => e.hunterActive);
    if (wasNight) {
      this.phase = 'day';
      this.log('☀️ 天亮了，进入讨论和投票阶段', 'system');
    } else {
      if (this.checkGameOver()) return;
      this.startNewRound();
      return;
    }
    this.broadcastState();
    this.broadcastPersonal();
  }

  afterVoteResult() {
    const eliminatedId = this._pendingElimination;
    this._pendingElimination = null;
    this._voteTally = null;

    if (eliminatedId) {
      const ep = this.players.find(p => p.socketId === eliminatedId);
      const result = this.killPlayer(eliminatedId, 'vote');
      if (result === 'hunter_dying') {
        this.narrate(`${ep?.name} 被放逐，作为猎人发动了技能！`);
        this.phase = 'hunter-shoot';
        this.broadcastState();
        this.broadcastPersonal();
        return;
      }
      // 白痴翻牌存活，继续游戏
      if (result === 'idiot_survived') {
        this.broadcastState();
        this.broadcastPersonal();
        // 不进入夜晚，继续当前阶段
        return;
      }
      // 警长死亡，需要处理警徽
      if (result === 'sheriff_dying') {
        this.narrate(`${ep?.name} 是警长，需要处理警徽...`);
        this.broadcastState();
        this.broadcastPersonal();
        return;
      }
    }

    if (this.checkGameOver()) return;
    this.startNewRound();
  }

  startNewRound() {
    this.round++;
    this.resetNightState();
    this.phase = 'night-werewolf';
    this.log(`🌑 第 ${this.round} 夜降临，狼人请行动`, 'system');
    this.narrate(`第 ${this.round} 夜降临，夜幕再次笼罩村庄。狼人请睁眼...`);
    this.broadcastState();
    this.broadcastPersonal();
  }

  checkGameOver() {
    const wolves = this.getAliveWerewolves().length;
    const villagers = this.getVillagerTeam().length;
    if (wolves === 0) {
      this.winner = 'villager';
      this.phase = 'gameover';
      this.log('🏆 好人阵营获胜！所有狼人已被消灭', 'system');
      this.recordReplay('game-over', { winner: 'villager', wolves: 0, villagers });
      this.narrate('游戏结束！所有狼人已被消灭，好人阵营获胜！村庄恢复和平。');
      this.broadcastState();
      this.broadcastPersonal();
      return true;
    }
    if (wolves >= villagers) {
      this.winner = 'werewolf';
      this.phase = 'gameover';
      this.log('🐺 狼人阵营获胜！黑暗降临', 'system');
      this.recordReplay('game-over', { winner: 'werewolf', wolves, villagers });
      this.narrate('游戏结束！狼人数量已超过好人，狼人阵营获胜！黑暗笼罩村庄。');
      this.broadcastState();
      this.broadcastPersonal();
      return true;
    }
    return false;
  }

  restart() {
    this.phase = 'lobby';
    this.round = 0;
    this.logs = [];
    this.chatHistory = [];
    this.resetNightState();
    this.players.forEach(p => {
      p.role = null;
      p.alive = true;
      p.revealed = false;
    });
    this.winner = null;
    this.broadcastState();
    this.broadcastPersonal();
  }
}

/* ===================== Socket.io 事件 ===================== */

io.on('connection', (socket) => {
  socket.on('create-room', (name, password, callback) => {
    const roomId = generateRoomId();
    const room = new Room(roomId, socket.id, name);
    if (password) room.password = password;
    rooms.set(roomId, room);
    socket.join(roomId);
    room.addPlayer(socket.id, name);
    callback({ success: true, roomId });
  });

  socket.on('join-room', (roomId, name, password, callback) => {
    const room = rooms.get(roomId.toUpperCase());
    if (!room) return callback({ success: false, error: '房间不存在' });
    if (room.phase !== 'lobby') return callback({ success: false, error: '游戏已开始，无法加入' });
    if (room.players.length >= MAX_PLAYERS) return callback({ success: false, error: '房间已满' });
    if (room.players.some(p => p.name === name)) return callback({ success: false, error: '昵称已存在' });
    if (room.password && room.password !== password) return callback({ success: false, error: '密码错误' });
    socket.join(roomId);
    room.addPlayer(socket.id, name);
    callback({ success: true, roomId });
  });

  socket.on('spectate-room', (roomId, name, password, callback) => {
    const room = rooms.get(roomId.toUpperCase());
    if (!room) return callback({ success: false, error: '房间不存在' });
    if (room.password && room.password !== password) return callback({ success: false, error: '密码错误' });
    if (room.spectators.length >= room.maxSpectators) return callback({ success: false, error: '观战人数已满' });
    socket.join(roomId);
    const success = room.addSpectator(socket.id, name);
    if (success) {
      callback({ success: true, roomId, isSpectator: true });
    } else {
      callback({ success: false, error: '无法加入观战' });
    }
  });

  socket.on('start-game', () => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.hostSocketId !== socket.id) return;
    if (!room.startGame()) {
      socket.emit('error-msg', '至少需要6名玩家');
    }
  });

  socket.on('kick-player', (targetSocketId) => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.hostSocketId !== socket.id) return;
    if (room.phase !== 'lobby') return;
    const target = room.players.find(p => p.socketId === targetSocketId);
    if (!target) return;
    room.removePlayer(targetSocketId);
    io.to(targetSocketId).emit('kicked', '你被房主踢出了房间');
    room.broadcastState();
  });

  socket.on('confirm-reveal', () => {
    const room = findRoomBySocket(socket.id);
    if (room) room.confirmReveal(socket.id);
  });

  socket.on('ww-vote', (targetId) => {
    const room = findRoomBySocket(socket.id);
    if (room) room.wwVote(socket.id, targetId);
  });

  socket.on('ww-confirm-kill', (targetId) => {
    const room = findRoomBySocket(socket.id);
    if (room) room.wwConfirmKill(socket.id, targetId);
  });

  socket.on('ww-chat', (message) => {
    const room = findRoomBySocket(socket.id);
    if (room) room.wwChat(socket.id, message);
  });

  socket.on('seer-check', (targetId) => {
    const room = findRoomBySocket(socket.id);
    if (room) room.seerCheck(socket.id, targetId);
  });

  socket.on('witch-action', (data) => {
    const room = findRoomBySocket(socket.id);
    if (room) room.witchAction(socket.id, data);
  });

  socket.on('guard-action', (targetId) => {
    const room = findRoomBySocket(socket.id);
    if (room) room.guardAction(socket.id, targetId);
  });

  socket.on('hunter-shoot', (targetId) => {
    const room = findRoomBySocket(socket.id);
    if (room) room.hunterShoot(socket.id, targetId);
  });

  socket.on('start-vote', () => {
    const room = findRoomBySocket(socket.id);
    if (room && room.hostSocketId === socket.id) room.startVote();
  });

  socket.on('cast-vote', (targetId) => {
    const room = findRoomBySocket(socket.id);
    if (room) room.castVote(socket.id, targetId);
  });

  socket.on('after-vote-result', () => {
    const room = findRoomBySocket(socket.id);
    if (room && room.hostSocketId === socket.id) room.afterVoteResult();
  });

  socket.on('last-words', (message) => {
    const room = findRoomBySocket(socket.id);
    if (room) room.sendLastWords(socket.id, message);
  });

  socket.on('skip-last-words', () => {
    const room = findRoomBySocket(socket.id);
    if (room && room.lastWordsPlayer === socket.id) room.endLastWords();
  });

  // 警长系统
  socket.on('nominate-sheriff', () => {
    const room = findRoomBySocket(socket.id);
    if (room) room.nominateSheriff(socket.id);
  });

  socket.on('end-nomination', () => {
    const room = findRoomBySocket(socket.id);
    if (room && room.hostSocketId === socket.id) room.endNomination();
  });

  socket.on('skip-sheriff-election', () => {
    const room = findRoomBySocket(socket.id);
    if (room && room.hostSocketId === socket.id) room.skipSheriffElection();
  });

  socket.on('vote-sheriff', (candidateId) => {
    const room = findRoomBySocket(socket.id);
    if (room) room.voteSheriff(socket.id, candidateId);
  });

  socket.on('transfer-sheriff', (targetId) => {
    const room = findRoomBySocket(socket.id);
    if (room) room.transferSheriff(targetId);
  });

  socket.on('restart-game', () => {
    const room = findRoomBySocket(socket.id);
    if (room && room.hostSocketId === socket.id) room.restart();
  });

  socket.on('get-replay', (callback) => {
    const room = findRoomBySocket(socket.id);
    if (!room) return callback?.({ success: false, error: '房间不存在' });
    callback?.({ success: true, replay: room.getReplay() });
  });

  socket.on('toggle-narration', () => {
    const room = findRoomBySocket(socket.id);
    if (room && room.hostSocketId === socket.id) {
      room.narrationEnabled = !room.narrationEnabled;
      room.broadcastState();
    }
  });

  socket.on('set-role-config', (config, callback) => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.hostSocketId !== socket.id) return callback?.({ success: false, error: '只有房主可以设置' });
    if (room.phase !== 'lobby') return callback?.({ success: false, error: '游戏已开始，无法修改' });

    const validation = validateRoleConfig(config, room.players.length);
    if (!validation.valid) return callback?.({ success: false, error: validation.error });

    room.roleConfig = config;
    room.broadcastState();
    callback?.({ success: true });
  });

  socket.on('reset-role-config', () => {
    const room = findRoomBySocket(socket.id);
    if (room && room.hostSocketId === socket.id && room.phase === 'lobby') {
      room.roleConfig = null;
      room.broadcastState();
    }
  });

  // 表情/互动系统
  socket.on('send-emotion', (emotionId) => {
    const room = findRoomBySocket(socket.id);
    if (!room) return;
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player || !player.alive) return; // 死亡玩家不能发表情

    // 广播给房间所有人（包括玩家和观战者）
    io.to(room.roomId).emit('receive-emotion', {
      socketId: socket.id,
      name: player.name,
      emotionId,
      time: Date.now()
    });
  });

  socket.on('send-quick-msg', (msg) => {
    const room = findRoomBySocket(socket.id);
    if (!room) return;
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) return;

    // 只在白天阶段可以发快捷消息
    if (room.phase !== 'day' && room.phase !== 'sheriff-nominate' && room.phase !== 'sheriff-speak') return;

    io.to(room.roomId).emit('quick-msg', {
      socketId: socket.id,
      name: player.name,
      msg,
      time: Date.now()
    });
  });

  socket.on('disconnect', () => {
    const room = findRoomBySocket(socket.id);
    if (room) {
      room.removePlayer(socket.id);
      room.removeSpectator(socket.id);
      if (room.players.length === 0 && room.spectators.length === 0) {
        rooms.delete(room.roomId);
      }
    }
  });
});

function findRoomBySocket(socketId) {
  for (const room of rooms.values()) {
    if (room.players.some(p => p.socketId === socketId)) return room;
  }
  return null;
}

/* ===================== 启动 ===================== */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🐺 狼人杀联机版服务器运行在 http://localhost:${PORT}`);
});
