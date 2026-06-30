// ============================================================
// 备件查询助手 - RAG 问答机器人 (Cloudflare Workers)
// 支持：打印机知识库 / Prompt 优化 / 结构化返回 / KV 缓存
//       限流保护 / 动态模型参数 / 多轮对话 / 批量问答 / CSV 导出
// ============================================================

// ---------- 模型配置（按环境区分） ----------
const MODELS = {
  development: {
    embed: '@cf/baai/bge-small-en-v1.5',
    chat: '@cf/meta/llama-2-7b-chat-int8',
  },
  production: {
    embed: '@cf/baai/bge-small-en-v1.5',
    chat: '@cf/qwen/qwen1.5-14b-chat-awq',
  },
};

// ---------- 限流配置 ----------
const RATE_LIMIT = {
  MAX_REQUESTS_PER_MINUTE: 30,
  WINDOW_SECONDS: 60,
};

// ---------- 打印机备件知识库 ----------
const KNOWLEDGE_BASE = [
  {
    id: 'prt-001',
    equipment: '激光打印机',
    fault: '打印出黑线/黑带',
    spare_part: '感光鼓组件',
    part_no: 'DR-1150',
    spec: '适用于 HP LaserJet Pro M404 系列',
    suggestion: '打印出现纵向黑线通常为感光鼓表面划伤或老化，更换感光鼓组件并清洁电晕丝。',
  },
  {
    id: 'prt-002',
    equipment: '激光打印机',
    fault: '打印全白/无图像',
    spare_part: '显影盒（粉盒）',
    part_no: 'CF258A',
    spec: 'HP 58A 黑色硒鼓，约 3000 页印量',
    suggestion: '打印全白多为粉盒碳粉耗尽或显影辊故障，更换粉盒并检查显影偏压。',
  },
  {
    id: 'prt-003',
    equipment: '激光打印机',
    fault: '卡纸频繁',
    spare_part: '拾纸辊',
    part_no: 'RK2-1807',
    spec: 'HP LaserJet Pro 拾纸辊组件',
    suggestion: '频繁卡纸且纸张歪斜多为拾纸辊磨损导致摩擦力不足，更换拾纸辊并清洁纸路。',
  },
  {
    id: 'prt-004',
    equipment: '激光打印机',
    fault: '定影不牢/掉粉',
    spare_part: '定影膜组件',
    part_no: 'RM2-5399',
    spec: 'HP M404 定影膜套件',
    suggestion: '打印内容一抹即掉为定影膜破损或加热灯管失效，更换定影膜组件。',
  },
  {
    id: 'prt-005',
    equipment: '喷墨打印机',
    fault: '打印缺色/断线',
    spare_part: '喷墨头',
    part_no: 'F6T44AE',
    spec: 'HP 905 喷墨头，三色一体',
    suggestion: '打印缺色断线经清洗仍无改善，多为喷嘴烧损，更换喷墨头。',
  },
  {
    id: 'prt-006',
    equipment: '喷墨打印机',
    fault: '墨水泄漏/污染',
    spare_part: '清洁单元（废墨垫）',
    part_no: 'CRG-WIPER-70',
    spec: 'Epson WorkForce 系列清洁单元',
    suggestion: '机内墨水泄漏多为清洁单元密封老化或废墨垫饱和，更换清洁单元及废墨垫。',
  },
  {
    id: 'prt-007',
    equipment: '喷墨打印机',
    fault: '进纸偏移/多页进纸',
    spare_part: '进纸分离垫',
    part_no: 'KF-0848',
    spec: 'Epson/Canon 通用分离垫',
    suggestion: '一次进多张纸为分离垫磨损失去摩擦差异，更换分离垫并调整弹簧张力。',
  },
  {
    id: 'prt-008',
    equipment: '针式打印机',
    fault: '打印缺针/字迹不清',
    spare_part: '打印头',
    part_no: 'EP-13650',
    spec: '24 针打印头，适用于 EPSON LQ-690K',
    suggestion: '打印缺划/断线多为针头断针或线圈烧毁，更换打印头并检查色带。',
  },
  {
    id: 'prt-009',
    equipment: '针式打印机',
    fault: '色带不走/打字变淡',
    spare_part: '色带驱动齿轮组',
    part_no: 'RB-GEAR-24P',
    spec: '24 齿色带驱动齿轮',
    suggestion: '色带停滞不走多为驱动齿轮磨损打滑，更换齿轮组并润滑传动轴。',
  },
  {
    id: 'prt-010',
    equipment: '针式打印机',
    fault: '走纸不齐/撕裂纸张',
    spare_part: '拖纸器（链轮）',
    part_no: 'TR-TRACTOR-LQ',
    spec: 'LQ 系列左右链轮组件',
    suggestion: '连续纸走偏撕裂多为链轮齿磨损，更换拖纸器链轮并校准左右对齐。',
  },
  {
    id: 'prt-011',
    equipment: '激光打印机',
    fault: '打印有底灰/背景发黑',
    spare_part: '转印辊',
    part_no: 'RK-TRSF-260A',
    spec: 'HP 260A 转印辊',
    suggestion: '打印底灰严重多为转印辊表面污染或老化，清洁或更换转印辊，并检查转印电压。',
  },
  {
    id: 'prt-012',
    equipment: '喷墨打印机',
    fault: '字车卡滞/异响',
    spare_part: '字车导轨润滑条',
    part_no: 'SLD-RAIL-IP',
    spec: 'Canon iP 系列导轨润滑条',
    suggestion: '字车移动卡滞或异响为导轨润滑脂干涸，更换润滑条并清洁导轨。',
  },
];

// ---------- CORS 响应头 ----------
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ---------- 工具函数 ----------
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function csvEscape(val) {
  const s = String(val ?? '');
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

function toSearchableText(item) {
  return `设备：${item.equipment}，故障：${item.fault}，备件：${item.spare_part}，型号：${item.part_no}，规格：${item.spec}，建议：${item.suggestion}`;
}

// 根据环境选择模型
function getModels(env) {
  const environment = env.ENVIRONMENT || 'development';
  return MODELS[environment] || MODELS.development;
}

// 根据问题复杂度动态调整模型参数
function getModelParams(question) {
  const complexKeywords = ['区别', '对比', '为什么', '原因', '分析', '原理', '如何选择'];
  const isComplex = complexKeywords.some((kw) => question.includes(kw));
  return {
    temperature: isComplex ? 0.3 : 0.1,
    max_tokens: isComplex ? 768 : 512,
  };
}

// ---------- 限流器（基于 KV 的滑动窗口） ----------
async function checkRateLimit(request, env) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const key = `rate:${ip}`;
  const now = Math.floor(Date.now() / 1000);

  const raw = await env.QA_CACHE.get(key);
  const timestamps = raw ? JSON.parse(raw) : [];

  // 过滤窗口外的时间戳
  const windowStart = now - RATE_LIMIT.WINDOW_SECONDS;
  const recent = timestamps.filter((t) => t > windowStart);

  if (recent.length >= RATE_LIMIT.MAX_REQUESTS_PER_MINUTE) {
    return false;
  }

  // 记录本次请求
  recent.push(now);
  await env.QA_CACHE.put(key, JSON.stringify(recent), {
    expirationTtl: RATE_LIMIT.WINDOW_SECONDS + 10,
  });
  return true;
}

// ---------- 优化后的 Prompt ----------
function buildPrompt(context, question, history = []) {
  const historyText =
    history.length > 0
      ? `【对话历史】\n${history.map((h) => `${h.role === 'user' ? '用户' : '助手'}：${h.content}`).join('\n')}\n\n`
      : '';

  return `你是制造业备件查询助手，仅基于以下检索结果回答，禁止编造信息：
1. 优先展示相似度最高的备件信息；
2. 回答格式：【备件名称】xxx 【型号】xxx 【规格】xxx 【更换建议】xxx；
3. 无匹配信息时，仅回复「未查询到相关备件，请联系设备工程师」。

${historyText}【知识库检索结果】
${context}

【用户问题】
${question}

【回答】`;
}

// 从模型回答中提取结构化字段
function extractStructuredAnswer(answer, topMatch) {
  if (!topMatch) return null;

  // 如果模型回答中未明确包含信息，从检索结果回填
  const extract = (label) => {
    const re = new RegExp(`【${label}】\\s*(.+?)(?=【|$)`, 's');
    const m = answer.match(re);
    return m ? m[1].trim() : '';
  };

  return {
    spare_part: extract('备件名称') || topMatch.metadata.spare_part,
    part_no: extract('型号') || topMatch.metadata.part_no,
    spec: extract('规格') || topMatch.metadata.spec,
    suggestion: extract('更换建议') || topMatch.metadata.suggestion,
  };
}

// ---------- /ingest：向量化知识库并写入 Vectorize ----------
async function handleIngest(env) {
  const { embed } = getModels(env);
  const texts = KNOWLEDGE_BASE.map(toSearchableText);

  // 尝试从 KV 缓存读取向量
  const cacheKey = `vectors:${embed}:${KNOWLEDGE_BASE.length}`;
  const cached = await env.VECTOR_CACHE.get(cacheKey, 'json');

  let vectors;
  if (cached && cached.length === KNOWLEDGE_BASE.length) {
    // 使用缓存的向量
    vectors = KNOWLEDGE_BASE.map((item, i) => ({
      id: item.id,
      values: cached[i],
      metadata: {
        equipment: item.equipment,
        fault: item.fault,
        spare_part: item.spare_part,
        part_no: item.part_no,
        spec: item.spec,
        suggestion: item.suggestion,
      },
    }));
  } else {
    // 调用嵌入模型生成向量
    const { data } = await env.AI.run(embed, { text: texts });

    vectors = KNOWLEDGE_BASE.map((item, i) => ({
      id: item.id,
      values: data[i],
      metadata: {
        equipment: item.equipment,
        fault: item.fault,
        spare_part: item.spare_part,
        part_no: item.part_no,
        spec: item.spec,
        suggestion: item.suggestion,
      },
    }));

    // 缓存向量结果到 KV
    await env.VECTOR_CACHE.put(cacheKey, JSON.stringify(data), {
      expirationTtl: 86400, // 缓存 24 小时
    });
  }

  await env.VECTORIZE.upsert(vectors);

  return jsonResponse({
    success: true,
    ingested: vectors.length,
    cached: !!cached,
    message: `已成功向量化 ${vectors.length} 条打印机备件知识并写入 Vectorize${cached ? '（命中向量缓存）' : ''}`,
  });
}

// ---------- /ask：检索 + 生成（单条） ----------
async function askSingle(question, env, sessionId = null) {
  const { embed, chat } = getModels(env);

  // 1. 检查问答缓存（问题哈希 → 缓存结果）
  const cacheKey = `qa:${question}`;
  const cachedResult = await env.QA_CACHE.get(cacheKey, 'json');
  if (cachedResult) {
    return { ...cachedResult, cached: true };
  }

  // 2. 将问题向量化
  const { data: questionVectors } = await env.AI.run(embed, {
    text: [question],
  });

  // 3. 在 Vectorize 中检索最相关的 Top-5 条目
  const { matches } = await env.VECTORIZE.query(questionVectors[0], {
    topK: 5,
    returnMetadata: 'all',
  });

  if (!matches || matches.length === 0) {
    const noMatch = {
      answer: '未查询到相关备件，请联系设备工程师',
      structured_answer: null,
      sources: [],
    };
    await env.QA_CACHE.put(cacheKey, JSON.stringify(noMatch), {
      expirationTtl: 3600,
    });
    return noMatch;
  }

  // 4. 拼接上下文
  const context = matches
    .map((m, i) => {
      const meta = m.metadata;
      return `[${i + 1}] 设备：${meta.equipment} | 故障：${meta.fault} | 备件：${meta.spare_part} | 型号：${meta.part_no} | 规格：${meta.spec} | 建议：${meta.suggestion} (相似度: ${m.score.toFixed(4)})`;
    })
    .join('\n');

  // 5. 获取多轮对话历史
  let history = [];
  if (sessionId) {
    const id = env.CHAT_SESSION.idFromName(sessionId);
    const stub = env.CHAT_SESSION.get(id);
    const histRes = await stub.fetch('http://internal/history');
    history = await histRes.json();
  }

  // 6. 构造 Prompt，调用对话模型
  const prompt = buildPrompt(context, question, history);
  const params = getModelParams(question);

  const { response: answer } = await env.AI.run(chat, {
    messages: [{ role: 'user', content: prompt }],
    ...params,
  });

  // 7. 提取结构化答案
  const structured_answer = extractStructuredAnswer(answer, matches[0]);

  // 8. 存入多轮对话历史
  if (sessionId) {
    const id = env.CHAT_SESSION.idFromName(sessionId);
    const stub = env.CHAT_SESSION.get(id);
    await stub.fetch('http://internal/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user', content: question }),
    });
    await stub.fetch('http://internal/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'assistant', content: answer }),
    });
  }

  // 9. 组装返回
  const sources = matches.map((m) => ({
    equipment: m.metadata.equipment,
    fault: m.metadata.fault,
    spare_part: m.metadata.spare_part,
    part_no: m.metadata.part_no,
    spec: m.metadata.spec,
    suggestion: m.metadata.suggestion,
    score: m.score,
  }));

  const result = { answer, structured_answer, sources, cached: false };

  // 10. 写入问答缓存
  await env.QA_CACHE.put(cacheKey, JSON.stringify(result), {
    expirationTtl: 3600, // 缓存 1 小时
  });

  return result;
}

// ---------- /ask：路由处理 ----------
async function handleAsk(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: '请求体不是合法 JSON' }, 400);
  }

  const { question, session_id } = body;
  if (!question || typeof question !== 'string') {
    return jsonResponse({ error: '请提供 question 字段' }, 400);
  }

  // 限流检查
  const allowed = await checkRateLimit(request, env);
  if (!allowed) {
    return jsonResponse({ error: '请求过于频繁，请稍后再试' }, 429);
  }

  const result = await askSingle(question, env, session_id || null);
  return jsonResponse(result);
}

// ---------- /batch-ask：批量问答 ----------
async function handleBatchAsk(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: '请求体不是合法 JSON' }, 400);
  }

  const { questions, session_id } = body;
  if (!Array.isArray(questions) || questions.length === 0) {
    return jsonResponse({ error: '请提供 questions 数组' }, 400);
  }

  if (questions.length > 10) {
    return jsonResponse({ error: '单次批量最多 10 个问题' }, 400);
  }

  // 限流检查
  const allowed = await checkRateLimit(request, env);
  if (!allowed) {
    return jsonResponse({ error: '请求过于频繁，请稍后再试' }, 429);
  }

  const results = await Promise.all(
    questions.map((q) => askSingle(q, env, session_id || null)),
  );

  return jsonResponse({ results });
}

// ---------- /export/csv：导出知识库为 CSV ----------
function handleExportCsv() {
  const headers = ['ID', '设备', '故障', '备件名称', '型号', '规格', '更换建议'];
  const rows = KNOWLEDGE_BASE.map((item) => [
    item.id,
    item.equipment,
    item.fault,
    item.spare_part,
    item.part_no,
    item.spec,
    item.suggestion,
  ]);

  const csv = [headers, ...rows]
    .map((row) => row.map(csvEscape).join(','))
    .join('\n');

  // BOM 头确保 Excel 正确识别 UTF-8
  return new Response('\uFEFF' + csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename=spare-parts-kb.csv',
      ...CORS_HEADERS,
    },
  });
}

// ---------- /export/qa-csv：导出问答历史为 CSV ----------
async function handleExportQaCsv(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: '请求体不是合法 JSON' }, 400);
  }

  const { qa_list } = body;
  if (!Array.isArray(qa_list) || qa_list.length === 0) {
    return jsonResponse({ error: '请提供 qa_list 数组，每项含 question 和 answer' }, 400);
  }

  const headers = ['问题', '回答', '备件名称', '型号', '规格', '更换建议'];
  const rows = qa_list.map((item) => [
    item.question || '',
    item.answer || '',
    item.structured_answer?.spare_part || '',
    item.structured_answer?.part_no || '',
    item.structured_answer?.spec || '',
    item.structured_answer?.suggestion || '',
  ]);

  const csv = [headers, ...rows]
    .map((row) => row.map(csvEscape).join(','))
    .join('\n');

  return new Response('\uFEFF' + csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename=qa-history.csv',
      ...CORS_HEADERS,
    },
  });
}

// ============================================================
// Durable Object: ChatSession（多轮对话状态管理）
// ============================================================
export class ChatSession {
  constructor(state) {
    this.state = state;
    this.history = [];
  }

  async fetch(request) {
    const url = new URL(request.url);

    // 获取对话历史
    if (url.pathname === '/history') {
      return new Response(JSON.stringify(this.history), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 追加对话消息
    if (url.pathname === '/add' && request.method === 'POST') {
      const msg = await request.json();
      this.history.push(msg);
      // 只保留最近 20 条上下文，防止 token 溢出
      if (this.history.length > 20) {
        this.history = this.history.slice(-20);
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 清空对话历史
    if (url.pathname === '/clear') {
      this.history = [];
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not found', { status: 404 });
  }
}

// ============================================================
// 主入口
// ============================================================
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      // ---------- 路由表 ----------

      // 写入知识库
      if (url.pathname === '/ingest' && request.method === 'POST') {
        return await handleIngest(env);
      }

      // 单条问答
      if (url.pathname === '/ask' && request.method === 'POST') {
        return await handleAsk(request, env);
      }

      // 批量问答
      if (url.pathname === '/batch-ask' && request.method === 'POST') {
        return await handleBatchAsk(request, env);
      }

      // 导出知识库 CSV
      if (url.pathname === '/export/csv' && request.method === 'GET') {
        return handleExportCsv();
      }

      // 导出问答结果 CSV
      if (url.pathname === '/export/qa-csv' && request.method === 'POST') {
        return await handleExportQaCsv(request, env);
      }

      // 清空对话历史
      if (url.pathname === '/chat/clear' && request.method === 'POST') {
        let body;
        try {
          body = await request.json();
        } catch {
          return jsonResponse({ error: '请求体不是合法 JSON' }, 400);
        }
        const { session_id } = body;
        if (!session_id) {
          return jsonResponse({ error: '请提供 session_id' }, 400);
        }
        const id = env.CHAT_SESSION.idFromName(session_id);
        const stub = env.CHAT_SESSION.get(id);
        return await stub.fetch('http://internal/clear');
      }

      // 默认欢迎页
      return jsonResponse({
        service: '打印机备件查询助手 RAG 问答机器人',
        environment: env.ENVIRONMENT || 'development',
        endpoints: {
          'POST /ingest': '将硬编码打印机知识库向量化并存入 Vectorize',
          'POST /ask': '单条问答 { "question": "...", "session_id": "可选" }',
          'POST /batch-ask': '批量问答 { "questions": [...], "session_id": "可选" }',
          'GET  /export/csv': '导出知识库为 CSV',
          'POST /export/qa-csv': '导出问答结果为 CSV { "qa_list": [...] }',
          'POST /chat/clear': '清空对话历史 { "session_id": "..." }',
        },
      });
    } catch (err) {
      return jsonResponse(
        { error: '服务器内部错误', detail: err.message },
        500,
      );
    }
  },
};
