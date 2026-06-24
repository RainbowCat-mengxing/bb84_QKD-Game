(function () {
  "use strict";

  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));
  const basisGlyph = basis => basis === BB84.Z ? "+" : "×";
  const percent = value => `${(value * 100).toFixed(value > 0 && value < 0.1 ? 1 : 0)}%`;
  const state = {
    role: "alice",
    encoding: "utf8",
    plan: null,
    result: null,
    decided: false,
    score: Number(localStorage.getItem("bb84-score") || 0)
  };

  const roleCopy = {
    alice: ["你扮演 Alice：重点控制原始密钥与制备基。", "单击切换制备基，双击翻转原始随机密钥位。"],
    bob: ["你扮演 Bob：自由选择每个光子的测量基。", "点击单元格切换 Bob 的测量基；Alice 的信息在筛基前保密。"],
    eve: ["你扮演 Eve：控制拦截位置、比例和测量基。", "点击单元格切换 Eve 测量基；双击可开启或关闭该位置的拦截。"]
  };

  function updateScore(delta = 0) {
    state.score += delta;
    localStorage.setItem("bb84-score", String(state.score));
    $("#totalScore").textContent = String(state.score);
  }

  function setRole(role) {
    const changed = state.role !== role;
    state.role = role;
    $$(".role-card").forEach(card => {
      const active = card.dataset.role === role;
      card.classList.toggle("selected", active);
      card.setAttribute("aria-pressed", String(active));
    });
    $("#roleHint").textContent = roleCopy[role][0];
    $("#manualHint").textContent = roleCopy[role][1];
    const eveControls = role === "eve";
    $("#eveMode").value = eveControls ? "yes" : "random";
    $("#eveMode").disabled = eveControls;
    if (changed && state.plan) {
      state.plan = null;
      state.result = null;
      state.decided = false;
      $("#workspace").classList.add("hidden");
      $("#resultSection").classList.add("hidden");
    }
  }

  function readMessage() {
    return BB84.encodeMessage($("#messageInput").value, state.encoding);
  }

  function updateBitPreview() {
    const validation = $("#validationMessage");
    try {
      const message = readMessage();
      $("#byteCount").textContent = `${message.bytes} 字节`;
      $("#bitCount").textContent = `${message.bits.length} bits`;
      const grouped = message.bits.join("").match(/.{1,8}/g) || [];
      $("#bitPreview").textContent = grouped.slice(0, 18).join(" ") + (grouped.length > 18 ? " …" : "");
      validation.textContent = "";
      return message;
    } catch (error) {
      $("#byteCount").textContent = "—";
      $("#bitCount").textContent = "—";
      $("#bitPreview").textContent = error.message;
      validation.textContent = error.message;
      return null;
    }
  }

  function syncRanges() {
    $("#noiseOutput").textContent = `${$("#noiseRate").value}%`;
    $("#sampleOutput").textContent = `${$("#sampleRate").value}%`;
    $("#thresholdOutput").textContent = `${$("#thresholdRate").value}%`;
    $("#attackLabel").textContent = `${$("#attackRate").value}%`;
  }

  function resetSettings() {
    $("#noiseRate").value = 1;
    $("#sampleRate").value = 25;
    $("#thresholdRate").value = 15;
    $("#attackRate").value = 75;
    $("#aliceStrategy").value = "random";
    $("#bobStrategy").value = "random";
    $("#eveStrategy").value = "random";
    $("#eveMode").value = state.role === "eve" ? "yes" : "random";
    syncRanges();
  }

  function preparePlan() {
    const message = updateBitPreview();
    if (!message) return;
    try {
      state.plan = BB84.createPlan({
        messageBits: message.bits,
        originalMessage: message.normalized,
        encoding: state.encoding,
        sampleRate: Number($("#sampleRate").value) / 100,
        aliceStrategy: $("#aliceStrategy").value,
        bobStrategy: $("#bobStrategy").value,
        eveStrategy: $("#eveStrategy").value,
        eveMode: state.role === "eve" ? "yes" : $("#eveMode").value,
        attackRate: Number($("#attackRate").value) / 100
      });
      state.result = null;
      state.decided = false;
      $("#workspace").classList.remove("hidden");
      $("#resultSection").classList.add("hidden");
      $("#photonCount").textContent = state.plan.length.toLocaleString("zh-CN");
      $("#requiredKeyCount").textContent = message.bits.length.toLocaleString("zh-CN");
      $("#workspaceSummary").textContent = roleCopy[state.role][1];
      renderPhotonGrid();
      $("#workspace").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      $("#validationMessage").textContent = error.message;
    }
  }

  function controlledBasis(index) {
    if (state.role === "alice") return state.plan.aliceBases[index];
    if (state.role === "bob") return state.plan.bobBases[index];
    return state.plan.eveBases[index];
  }

  function setControlledBasis(index, basis) {
    if (state.role === "alice") state.plan.aliceBases[index] = basis;
    else if (state.role === "bob") state.plan.bobBases[index] = basis;
    else state.plan.eveBases[index] = basis;
  }

  function renderPhotonGrid() {
    const grid = $("#photonGrid");
    grid.textContent = "";
    const visible = Math.min(96, state.plan.length);
    for (let index = 0; index < visible; index += 1) {
      const basis = controlledBasis(index);
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = `photon-cell ${basis === BB84.X ? "x" : ""} ${state.role === "eve" && state.plan.eveAttackMask[index] ? "attacking" : ""}`;
      cell.dataset.index = String(index);
      const bit = state.role === "alice" ? `<span class="cell-bit">${state.plan.rawBits[index]}</span>` : `<span class="cell-bit">q${String(index + 1).padStart(2, "0")}</span>`;
      const tap = state.role === "eve" && state.plan.eveAttackMask[index] ? '<span class="tap-mark" title="该位已拦截"></span>' : "";
      cell.innerHTML = `${tap}<span class="cell-index">${index + 1}</span>${bit}<span class="cell-basis">${basisGlyph(basis)}</span>`;
      cell.setAttribute("aria-label", `第 ${index + 1} 位，${basis} 基`);
      cell.addEventListener("click", event => {
        const i = Number(event.currentTarget.dataset.index);
        setControlledBasis(i, controlledBasis(i) === BB84.Z ? BB84.X : BB84.Z);
        renderPhotonGrid();
      });
      if (state.role === "alice") {
        cell.addEventListener("dblclick", event => {
          event.preventDefault();
          const i = Number(event.currentTarget.dataset.index);
          state.plan.rawBits[i] ^= 1;
          renderPhotonGrid();
        });
      }
      if (state.role === "eve") {
        cell.addEventListener("dblclick", event => {
          event.preventDefault();
          const i = Number(event.currentTarget.dataset.index);
          state.plan.eveAttackMask[i] = !state.plan.eveAttackMask[i];
          renderPhotonGrid();
        });
      }
      grid.appendChild(cell);
    }
    $("#gridNote").textContent = state.plan.length > visible
      ? `为保持界面清晰，仅展开前 ${visible} 个光子；其余 ${state.plan.length - visible} 个沿用所选策略。${state.role === "eve" ? " 双击单元格切换是否拦截。" : ""}`
      : `${state.role === "eve" ? "单击切换基，双击切换是否拦截。" : "单击任意单元格切换基。"}`;
  }

  function fillControlled(strategy) {
    if (!state.plan) return;
    const bases = BB84.buildPattern(state.plan.length, strategy);
    bases.forEach((basis, index) => setControlledBasis(index, basis));
    if (state.role === "alice" && strategy === "random") state.plan.rawBits = Array.from({ length: state.plan.length }, () => BB84.randomBit());
    if (state.role === "eve") {
      const rate = Number($("#attackRate").value) / 100;
      state.plan.eveAttackMask = Array.from({ length: state.plan.length }, () => Math.random() < rate);
    }
    renderPhotonGrid();
  }

  function transmit() {
    if (!state.plan) return;
    state.result = BB84.simulate(state.plan, { noiseRate: Number($("#noiseRate").value) / 100 });
    state.decided = false;
    renderResults(false);
    $("#resultSection").classList.remove("hidden");
    $("#resultSection").scrollIntoView({ behavior: "smooth", block: "start" });

    if (state.role === "eve") {
      const threshold = Number($("#thresholdRate").value) / 100;
      const aborted = state.result.qber > threshold || !state.result.enoughKey;
      window.setTimeout(() => settleEve(aborted), 500);
    }
  }

  function renderResults(revealEve) {
    const result = state.result;
    const threshold = Number($("#thresholdRate").value) / 100;
    $("#siftedMetric").textContent = result.siftedIndices.length.toLocaleString("zh-CN");
    $("#errorMetric").textContent = `${result.errors} / ${result.sampleIndices.length}`;
    $("#qberMetric").textContent = percent(result.qber);
    $("#thresholdMetric").textContent = `警戒线 ${percent(threshold)}`;
    $(".qber-card").classList.toggle("warning", result.qber > threshold);
    $("#keyMetric").textContent = result.keyIndices.length.toLocaleString("zh-CN");
    $("#keyState").textContent = result.enoughKey ? "足够执行一次一密" : `尚缺 ${Math.max(0, state.plan.messageBits.length - result.keyIndices.length)} 位`;
    $("#decisionPanel").classList.toggle("hidden", state.role === "eve" || state.decided);
    $("#newRoundButton").classList.toggle("hidden", !state.decided && state.role !== "eve");
    renderTrace(revealEve);
  }

  function renderTrace(revealEve) {
    $("#traceLock").textContent = revealEve ? "完整信道轨迹已揭晓" : "Eve 轨迹将在决策后揭晓";
    const body = $("#traceBody");
    body.textContent = "";
    state.result.records.slice(0, 40).forEach(record => {
      const row = document.createElement("tr");
      const eve = revealEve
        ? (record.attacked ? `<code>${record.eveResult}${basisGlyph(record.eveBasis)}</code>` : "—")
        : "?";
      const status = record.sampled ? '<span class="status-pill sample">公开抽样</span>' : record.kept ? '<span class="status-pill keep">保留</span>' : '<span class="status-pill drop">丢弃</span>';
      row.innerHTML = `<td>${record.index + 1}</td><td><code>${record.aliceBit}</code></td><td>${basisGlyph(record.aliceBasis)}</td><td>${eve}</td><td>${basisGlyph(record.bobBasis)}</td><td><code>${record.bobResult}</code></td><td>${status}</td>`;
      body.appendChild(row);
    });
  }

  function decide(abort) {
    if (state.decided) return;
    state.decided = true;
    const attacked = state.result.actualEavesdropping;
    let won = false;
    let delta = 0;
    let title;
    let copy;
    if (!state.result.enoughKey) {
      title = "密钥长度不足";
      copy = "双方选择的基过少重合，筛后密钥无法覆盖消息。请增加随机性或让双方的选基分布更均衡。";
      delta = -20;
    } else if (abort && attacked) {
      won = true; delta = 120; title = "成功识破 Eve"; copy = "你及时中止了通信。公开抽样位被丢弃，未使用受污染密钥。";
    } else if (!abort && !attacked) {
      won = true; delta = 90; title = "安全传输完成"; copy = `纠错与隐私放大完成，Bob 恢复消息：“${state.plan.originalMessage}”`;
    } else if (abort && !attacked) {
      delta = -40; title = "误报：信道中没有 Eve"; copy = "噪声或有限抽样让你过度警觉。密钥被安全丢弃，但本局通信失败。";
    } else {
      delta = -100; title = "游戏失败：Eve 已窃听"; copy = `你选择继续使用受污染密钥。Eve 精确掌握了约 ${percent(state.result.eveKnowledgeRate)} 的消息密钥位。`;
    }
    updateScore(delta);
    renderResults(true);
    showOutcome({ won, title, copy, delta, aborted: abort });
  }

  function settleEve(aborted) {
    if (state.decided) return;
    state.decided = true;
    const leak = state.result.eveKnowledgeRate;
    const won = !aborted && state.result.actualEavesdropping && leak > 0;
    const delta = won ? 100 + Math.round(leak * 100) : -80;
    updateScore(delta);
    renderResults(true);
    const title = won ? "潜伏成功：守方继续通信" : "窃听暴露：通信已中止";
    const copy = won
      ? `你的扰动没有越过警戒线，精确掌握约 ${percent(leak)} 的消息密钥位。实际协议的隐私放大会进一步压缩你的信息。`
      : `公开抽样得到 ${percent(state.result.qber)} QBER，守方警戒线为 ${$("#thresholdRate").value}%。`;
    showOutcome({ won, title, copy, delta, aborted });
  }

  function showOutcome({ won, title, copy, delta }) {
    const dialog = $("#outcomeDialog");
    dialog.classList.toggle("lost", !won);
    $("#outcomeSymbol").textContent = won ? "✓" : "!";
    $("#outcomeKicker").textContent = won ? "ROUND SECURED" : "ROUND FAILED";
    $("#outcomeTitle").textContent = title;
    $("#outcomeCopy").textContent = copy;
    $("#outcomeStats").innerHTML = `<div><strong>${delta > 0 ? "+" : ""}${delta}</strong><span>本局得分</span></div><div><strong>${percent(state.result.qber)}</strong><span>公开样本 QBER</span></div><div><strong>${state.result.attackedCount}</strong><span>实际拦截光子</span></div><div><strong>${percent(state.result.eveKnowledgeRate)}</strong><span>Eve 精确知晓率</span></div>`;
    dialog.showModal();
  }

  function newRound() {
    state.plan = null;
    state.result = null;
    state.decided = false;
    $("#workspace").classList.add("hidden");
    $("#resultSection").classList.add("hidden");
    $(".console-section").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  $$(".role-card").forEach(card => card.addEventListener("click", () => setRole(card.dataset.role)));
  $$("[data-encoding]").forEach(button => button.addEventListener("click", () => {
    state.encoding = button.dataset.encoding;
    $$("[data-encoding]").forEach(item => item.classList.toggle("active", item === button));
    $("#messageInput").placeholder = state.encoding === "binary" ? "例如：01001000 01101001" : "输入待保护消息";
    updateBitPreview();
  }));
  $("#messageInput").addEventListener("input", updateBitPreview);
  ["#noiseRate", "#sampleRate", "#thresholdRate", "#attackRate"].forEach(id => $(id).addEventListener("input", syncRanges));
  $("#resetSettings").addEventListener("click", resetSettings);
  $("#prepareButton").addEventListener("click", preparePlan);
  $("#transmitButton").addEventListener("click", transmit);
  $("#cancelPlanButton").addEventListener("click", () => $("#workspace").classList.add("hidden"));
  $$("[data-fill]").forEach(button => button.addEventListener("click", () => fillControlled(button.dataset.fill)));
  $("#abortButton").addEventListener("click", () => decide(true));
  $("#continueButton").addEventListener("click", () => decide(false));
  $("#newRoundButton").addEventListener("click", newRound);
  $("#theoryButton").addEventListener("click", () => $("#theoryDialog").showModal());
  $("#outcomeClose").addEventListener("click", () => window.setTimeout(() => $("#resultSection").scrollIntoView({ behavior: "smooth" }), 0));

  updateScore(0);
  setRole("alice");
  syncRanges();
  updateBitPreview();
})();
