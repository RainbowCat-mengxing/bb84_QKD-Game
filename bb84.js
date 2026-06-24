(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BB84 = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const Z = "Z";
  const X = "X";

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function randomBit(rng = Math.random) {
    return rng() < 0.5 ? 0 : 1;
  }

  function randomBasis(rng = Math.random) {
    return rng() < 0.5 ? Z : X;
  }

  function bytesToBits(bytes) {
    const bits = [];
    for (const byte of bytes) {
      for (let shift = 7; shift >= 0; shift -= 1) bits.push((byte >> shift) & 1);
    }
    return bits;
  }

  function bitsToBytes(bits) {
    const bytes = [];
    for (let i = 0; i + 7 < bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j += 1) byte = (byte << 1) | Number(bits[i + j]);
      bytes.push(byte);
    }
    return Uint8Array.from(bytes);
  }

  function encodeMessage(text, encoding = "utf8") {
    if (encoding === "binary") {
      const clean = String(text).replace(/\s+/g, "");
      if (!clean || /[^01]/.test(clean)) throw new Error("比特模式只接受 0、1 和空格。 ");
      return { bits: Array.from(clean, Number), bytes: Math.ceil(clean.length / 8), normalized: clean };
    }
    if (!String(text).length) throw new Error("请输入待保护消息。 ");
    let bytes;
    if (encoding === "ascii") {
      const values = [];
      for (const character of String(text)) {
        const code = character.codePointAt(0);
        if (code > 127) throw new Error("ASCII 模式不支持中文或扩展字符，请切换 UTF-8。 ");
        values.push(code);
      }
      bytes = Uint8Array.from(values);
    } else {
      bytes = new TextEncoder().encode(String(text));
    }
    return { bits: bytesToBits(bytes), bytes: bytes.length, normalized: String(text) };
  }

  function decodeBits(bits, encoding = "utf8") {
    if (encoding === "binary") return bits.join("");
    const bytes = bitsToBytes(bits);
    if (encoding === "ascii") return Array.from(bytes, byte => String.fromCharCode(byte)).join("");
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }

  function buildPattern(length, strategy = "random", rng = Math.random) {
    const output = [];
    for (let i = 0; i < length; i += 1) {
      if (strategy === "z") output.push(Z);
      else if (strategy === "x") output.push(X);
      else if (strategy === "alternating") output.push(i % 2 === 0 ? Z : X);
      else output.push(randomBasis(rng));
    }
    return output;
  }

  function expectedPhotonCount(messageBitCount, sampleRate) {
    const retention = Math.max(0.15, 0.5 * (1 - clamp(sampleRate, 0, 0.8)));
    return clamp(Math.ceil((messageBitCount + 24) / retention * 1.35), 64, 8192);
  }

  function createPlan(options = {}) {
    const rng = options.rng || Math.random;
    const messageBits = Array.from(options.messageBits || []);
    if (!messageBits.length) throw new Error("消息没有可发送的比特。 ");
    const sampleRate = clamp(Number(options.sampleRate ?? 0.25), 0.05, 0.8);
    const length = Number(options.photonCount) || expectedPhotonCount(messageBits.length, sampleRate);
    const evePresent = options.eveMode === "yes" || (options.eveMode !== "no" && rng() < Number(options.eveProbability ?? 0.55));
    const attackRate = clamp(Number(options.attackRate ?? 0.75), 0, 1);
    return {
      length,
      messageBits,
      rawBits: Array.from({ length }, () => randomBit(rng)),
      aliceBases: buildPattern(length, options.aliceStrategy, rng),
      bobBases: buildPattern(length, options.bobStrategy, rng),
      eveBases: buildPattern(length, options.eveStrategy, rng),
      evePresent,
      eveAttackMask: Array.from({ length }, () => evePresent && rng() < attackRate),
      sampleRate,
      encoding: options.encoding || "utf8",
      originalMessage: options.originalMessage || ""
    };
  }

  function measure(bit, preparedBasis, measurementBasis, rng = Math.random) {
    return preparedBasis === measurementBasis ? Number(bit) : randomBit(rng);
  }

  function shuffled(values, rng = Math.random) {
    const result = Array.from(values);
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function xorBits(a, b) {
    if (b.length < a.length) throw new Error("可用密钥不足以执行一次一密。 ");
    return a.map((bit, index) => Number(bit) ^ Number(b[index]));
  }

  function simulate(plan, options = {}) {
    const rng = options.rng || Math.random;
    const noiseRate = clamp(Number(options.noiseRate ?? 0), 0, 1);
    const records = [];
    for (let i = 0; i < plan.length; i += 1) {
      let stateBit = plan.rawBits[i];
      let stateBasis = plan.aliceBases[i];
      let eveResult = null;
      const attacked = Boolean(plan.evePresent && plan.eveAttackMask[i]);
      if (attacked) {
        eveResult = measure(stateBit, stateBasis, plan.eveBases[i], rng);
        stateBit = eveResult;
        stateBasis = plan.eveBases[i];
      }
      let bobResult = measure(stateBit, stateBasis, plan.bobBases[i], rng);
      const noiseFlip = rng() < noiseRate;
      if (noiseFlip) bobResult ^= 1;
      records.push({
        index: i,
        aliceBit: plan.rawBits[i],
        aliceBasis: plan.aliceBases[i],
        attacked,
        eveBasis: attacked ? plan.eveBases[i] : null,
        eveResult,
        bobBasis: plan.bobBases[i],
        bobResult,
        noiseFlip,
        basisMatch: plan.aliceBases[i] === plan.bobBases[i]
      });
    }

    const siftedIndices = records.filter(record => record.basisMatch).map(record => record.index);
    const requestedSamples = siftedIndices.length ? Math.max(1, Math.floor(siftedIndices.length * plan.sampleRate)) : 0;
    const sampleIndices = shuffled(siftedIndices, rng).slice(0, requestedSamples);
    const sampleSet = new Set(sampleIndices);
    const errors = sampleIndices.filter(index => records[index].aliceBit !== records[index].bobResult).length;
    const qber = sampleIndices.length ? errors / sampleIndices.length : 0;
    const keyIndices = siftedIndices.filter(index => !sampleSet.has(index));
    const aliceKey = keyIndices.map(index => records[index].aliceBit);
    const bobKey = keyIndices.map(index => records[index].bobResult);
    const requiredBits = plan.messageBits.length;
    const enoughKey = aliceKey.length >= requiredBits;
    let cipherBits = [];
    let bobDecodedBits = [];
    let decodedMessage = "";
    if (enoughKey) {
      cipherBits = xorBits(plan.messageBits, aliceKey);
      bobDecodedBits = xorBits(cipherBits, bobKey);
      decodedMessage = decodeBits(bobDecodedBits, plan.encoding);
    }

    const protectedKeyIndices = keyIndices.slice(0, requiredBits);
    const eveExactKnown = protectedKeyIndices.filter(index => {
      const record = records[index];
      return record.attacked && record.eveBasis === record.aliceBasis;
    }).length;
    const attackedCount = records.filter(record => record.attacked).length;
    const actualEavesdropping = attackedCount > 0;

    for (const record of records) {
      record.sampled = sampleSet.has(record.index);
      record.kept = record.basisMatch && !record.sampled;
    }

    return {
      records,
      siftedIndices,
      sampleIndices,
      keyIndices,
      aliceKey,
      bobKey,
      qber,
      errors,
      enoughKey,
      cipherBits,
      bobDecodedBits,
      decodedMessage,
      attackedCount,
      actualEavesdropping,
      eveExactKnown,
      eveKnowledgeRate: requiredBits ? eveExactKnown / requiredBits : 0
    };
  }

  return {
    Z,
    X,
    clamp,
    randomBit,
    randomBasis,
    bytesToBits,
    bitsToBytes,
    encodeMessage,
    decodeBits,
    buildPattern,
    expectedPhotonCount,
    createPlan,
    measure,
    xorBits,
    simulate
  };
});
