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
};

const MIN_PLAYERS = 6;
const MAX_PLAYERS = 18;
const VOTE_TIME_MS = 60000; // 白天投票限时60秒

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
      this.narrate('守卫完成守护，所有人闭眼。天即将亮...');
    } else {
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
    this.phase = 'day';
    this.log('☀️ 天亮了，进入讨论和投票阶段', 'system');
    this.broadcastState();
    this.broadcastPersonal();
  }

  killPlayer(socketId, cause) {
    const p = this.players.find(pl => pl.socketId === socketId);
    if (!p || !p.alive) return false;
    p.alive = false;
    const causeText = cause === 'vote' ? '被投票放逐' : cause === 'poison' ? '被女巫毒杀' : cause === 'hunter' ? '被猎人开枪带走' : '被狼人猎杀';
    this.log(`${p.name} ${causeText}`, 'kill');

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
    for (const [, targetId] of Object.entries(this.votes)) {
      tally[targetId] = (tally[targetId] || 0) + 1;
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
      this.narrate(`投票结束！${ep.name} 以 ${maxVotes} 票被放逐。`);
    } else {
      this.log(topCandidates.length > 1 ? '平票！无人被放逐' : '无人投票，无人被放逐', 'vote');
      this.narrate(topCandidates.length > 1 ? '投票结束！出现平票，本轮无人被放逐。' : '投票结束！无人投票，本轮无人被放逐。');
    }

    this._pendingElimination = eliminatedId;
    this._voteTally = tally;
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
      this.narrate('游戏结束！所有狼人已被消灭，好人阵营获胜！村庄恢复和平。');
      this.broadcastState();
      this.broadcastPersonal();
      return true;
    }
    if (wolves >= villagers) {
      this.winner = 'werewolf';
      this.phase = 'gameover';
      this.log('🐺 狼人阵营获胜！黑暗降临', 'system');
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
  socket.on('create-room', (name, callback) => {
    const roomId = generateRoomId();
    const room = new Room(roomId, socket.id, name);
    rooms.set(roomId, room);
    socket.join(roomId);
    room.addPlayer(socket.id, name);
    callback({ success: true, roomId });
  });

  socket.on('join-room', (roomId, name, callback) => {
    const room = rooms.get(roomId.toUpperCase());
    if (!room) return callback({ success: false, error: '房间不存在' });
    if (room.phase !== 'lobby') return callback({ success: false, error: '游戏已开始' });
    if (room.players.length >= MAX_PLAYERS) return callback({ success: false, error: '房间已满' });
    if (room.players.some(p => p.name === name)) return callback({ success: false, error: '昵称已存在' });
    socket.join(roomId);
    room.addPlayer(socket.id, name);
    callback({ success: true, roomId });
  });

  socket.on('start-game', () => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.hostSocketId !== socket.id) return;
    if (!room.startGame()) {
      socket.emit('error-msg', '至少需要6名玩家');
    }
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

  socket.on('restart-game', () => {
    const room = findRoomBySocket(socket.id);
    if (room && room.hostSocketId === socket.id) room.restart();
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

  socket.on('disconnect', () => {
    const room = findRoomBySocket(socket.id);
    if (room) {
      room.removePlayer(socket.id);
      if (room.players.length === 0) {
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
