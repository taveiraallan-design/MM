// Worker principal — plataforma de estudo C_TS452
// Endpoints:
//   GET  /api/due                     fila do dia (vencidos + novos, interleaved)
//   POST /api/review                  registra tentativa + recalcula FSRS
//   GET  /api/concepts/:id/state      debug do estado FSRS
//   POST /api/sessions                abre sessão { mode }
//   POST /api/sessions/:id/end        fecha sessão
//   GET  /api/stats                   o que eu mais erro, por área e conceito
//   POST /api/examiner/scenario       IA gera cenário novo p/ um conceito
//   POST /api/examiner/evaluate       IA avalia a resposta discursiva

import { calculateFSRS } from './fsrs.js';

const MODEL = 'claude-sonnet-4-6';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // -------- fila do dia --------
      if (path === '/api/due' && request.method === 'GET') {
        const now = new Date().toISOString();
        const { results } = await env.DB.prepare(
          `SELECT c.id, c.area, c.weight_pct, c.title, c.production_rule,
                  c.fiori_app_name, c.work_case_ref,
                  s.state, s.due, s.stability, s.reps, s.lapses
             FROM concepts c
             LEFT JOIN fsrs_state s ON s.concept_id = c.id
            WHERE s.concept_id IS NULL OR s.due <= ?
            ORDER BY CASE WHEN s.due IS NULL THEN 1 ELSE 0 END,
                     s.due ASC,
                     RANDOM()
            LIMIT 12`
        ).bind(now).all();
        return json({ due: results, count: results.length });
      }

      // -------- registrar review --------
      if (path === '/api/review' && request.method === 'POST') {
        const body = await request.json();
        const { concept_id, rating } = body;
        if (!concept_id || !rating || rating < 1 || rating > 4) {
          return json({ error: 'concept_id e rating (1-4) são obrigatórios' }, 400);
        }

        const current = await env.DB.prepare(
          'SELECT * FROM fsrs_state WHERE concept_id = ?'
        ).bind(concept_id).first();

        const next = calculateFSRS(rating, current, new Date());

        if (current) {
          await env.DB.prepare(
            `UPDATE fsrs_state
                SET stability=?, difficulty=?, elapsed_days=?, scheduled_days=?,
                    reps=?, lapses=?, state=?, last_review=?, due=?
              WHERE concept_id=?`
          ).bind(
            next.stability, next.difficulty, next.elapsed_days,
            next.scheduled_days, next.reps, next.lapses, next.state,
            next.last_review, next.due, concept_id
          ).run();
        } else {
          await env.DB.prepare(
            `INSERT INTO fsrs_state
               (concept_id, stability, difficulty, elapsed_days, scheduled_days,
                reps, lapses, state, last_review, due)
             VALUES (?,?,?,?,?,?,?,?,?,?)`
          ).bind(
            concept_id, next.stability, next.difficulty, next.elapsed_days,
            next.scheduled_days, next.reps, next.lapses, next.state,
            next.last_review, next.due
          ).run();
        }

        await env.DB.prepare(
          `INSERT INTO attempts
             (concept_id, session_id, rating, scenario_text, user_answer,
              ai_evaluation, correct)
           VALUES (?,?,?,?,?,?,?)`
        ).bind(
          concept_id, body.session_id ?? null, rating,
          body.scenario_text ?? null, body.user_answer ?? null,
          body.ai_evaluation ?? null,
          body.correct != null ? (body.correct ? 1 : 0) : null
        ).run();

        return json({ concept_id, ...next });
      }

      // -------- estado de um conceito --------
      const stateMatch = path.match(/^\/api\/concepts\/(\d+)\/state$/);
      if (stateMatch && request.method === 'GET') {
        const row = await env.DB.prepare(
          `SELECT c.title, c.area, s.*
             FROM concepts c
             LEFT JOIN fsrs_state s ON s.concept_id = c.id
            WHERE c.id = ?`
        ).bind(stateMatch[1]).first();
        return row ? json(row) : json({ error: 'conceito não encontrado' }, 404);
      }

      // -------- sessões --------
      if (path === '/api/sessions' && request.method === 'POST') {
        const { mode } = await request.json().catch(() => ({}));
        const res = await env.DB.prepare(
          'INSERT INTO sessions (mode) VALUES (?)'
        ).bind(mode ?? 'retrieval').run();
        return json({ session_id: res.meta.last_row_id });
      }

      const endMatch = path.match(/^\/api\/sessions\/(\d+)\/end$/);
      if (endMatch && request.method === 'POST') {
        await env.DB.prepare(
          "UPDATE sessions SET ended_at = CURRENT_TIMESTAMP WHERE id = ?"
        ).bind(endMatch[1]).run();
        return json({ ok: true });
      }

      // -------- estatísticas: o que eu mais erro --------
      if (path === '/api/stats' && request.method === 'GET') {
        const byArea = await env.DB.prepare(
          `SELECT c.area,
                  COUNT(*) AS tentativas,
                  SUM(CASE WHEN a.rating = 1 THEN 1 ELSE 0 END) AS erros
             FROM attempts a JOIN concepts c ON c.id = a.concept_id
            GROUP BY c.area ORDER BY erros DESC`
        ).all();
        const worst = await env.DB.prepare(
          `SELECT c.id, c.title, c.area,
                  COUNT(*) AS tentativas,
                  SUM(CASE WHEN a.rating = 1 THEN 1 ELSE 0 END) AS erros
             FROM attempts a JOIN concepts c ON c.id = a.concept_id
            GROUP BY c.id HAVING erros > 0
            ORDER BY erros DESC, tentativas ASC LIMIT 10`
        ).all();
        return json({ por_area: byArea.results, piores_conceitos: worst.results });
      }

      // -------- examinador IA: gerar cenário --------
      if (path === '/api/examiner/scenario' && request.method === 'POST') {
        const { concept_id, mode } = await request.json();
        const concept = await env.DB.prepare(
          'SELECT * FROM concepts WHERE id = ?'
        ).bind(concept_id).first();
        if (!concept) return json({ error: 'conceito não encontrado' }, 404);

        const recentes = await env.DB.prepare(
          `SELECT scenario_text FROM attempts
            WHERE concept_id = ? AND scenario_text IS NOT NULL
            ORDER BY answered_at DESC LIMIT 3`
        ).bind(concept_id).all();

        const system = `Você é o examinador da certificação SAP C_TS452 (S/4HANA Sourcing and Procurement).
A prova real é prática (System-Based Assessment), open-book, dentro de um Fiori Launchpad simulado onde apps são buscados pelo NOME, não por código de transação.
Gere cenários práticos em português brasileiro, curtos e realistas (contexto industrial, plantas de caminhões, fornecedores, fiscal Brasil quando couber).
NUNCA repita cenários anteriores. Separe SEMPRE o que é dado fornecido do que exige raciocínio.
Responda APENAS com JSON válido, sem markdown, sem texto antes ou depois.`;

        const modo = mode === 'worked_example'
          ? 'Modo worked example: inclua no campo "raciocinio_parcial" os 2 primeiros passos do raciocínio resolvidos, deixando o passo final para o aluno.'
          : 'Modo retrieval: não dê nenhuma pista do raciocínio.';

        const prompt = `Conceito a testar:
- Título: ${concept.title}
- Área: ${concept.area}
- Regra de produção: ${concept.production_rule ?? 'n/a'}
- App Fiori relacionado: ${concept.fiori_app_name ?? 'n/a'}
- Caso real do aluno (use como inspiração, mas mude os dados): ${concept.work_case_ref ?? 'nenhum'}

Cenários já usados (NÃO repita):
${(recentes.results || []).map(r => '- ' + (r.scenario_text || '').slice(0, 150)).join('\n') || 'nenhum'}

${modo}

Retorne JSON com esta estrutura exata:
{
  "cenario": "texto curto do cenário (máx 4 frases)",
  "dados_fornecidos": ["dado 1", "dado 2"],
  "pergunta": "o que o aluno deve decidir/responder",
  "raciocinio_parcial": "string ou null",
  "fluxo": ["PR","PO","GR","IV"],
  "etapa_critica": "qual etapa do fluxo quebra se a decisão for errada (deve ser um item de fluxo)"
}
O campo "fluxo" deve refletir o processo real do cenário (pode ser outro, ex: ["MRP","PR","PO"] ou ["GR","QI","Livre"]).`;

        const scenario = await callClaude(env, system, prompt);
        return json({ concept, scenario });
      }

      // -------- examinador IA: avaliar resposta --------
      if (path === '/api/examiner/evaluate' && request.method === 'POST') {
        const { concept_id, scenario, answer } = await request.json();
        const concept = await env.DB.prepare(
          'SELECT * FROM concepts WHERE id = ?'
        ).bind(concept_id).first();
        if (!concept) return json({ error: 'conceito não encontrado' }, 404);

        const system = `Você avalia respostas discursivas de um candidato à certificação SAP C_TS452.
Avalie o RACIOCÍNIO, não palavras-chave: uma resposta com termos diferentes mas lógica correta está certa; uma resposta com jargão certo mas lógica errada está errada.
Seja direto e específico no feedback, em português brasileiro, máximo 3 frases.
Responda APENAS com JSON válido, sem markdown.`;

        const prompt = `Conceito: ${concept.title}
Regra correta: ${concept.production_rule ?? 'n/a'}
Cenário apresentado: ${JSON.stringify(scenario)}
Resposta do candidato: "${answer}"

Retorne JSON com esta estrutura exata:
{
  "correct": true/false,
  "feedback": "por que está certo ou errado, apontando o passo exato do raciocínio",
  "etapa_quebrada": "se errado: em qual etapa do fluxo a decisão errada estoura (item do campo fluxo do cenário); se certo: null",
  "sugestao_rating": 1-4
}
Regra do sugestao_rating: 1 se raciocínio errado, 2 se certo mas com hesitação/imprecisão, 3 se certo e sólido, 4 se certo, completo e além do esperado.`;

        const evaluation = await callClaude(env, system, prompt);
        return json({ evaluation });
      }

      return json({ error: 'rota não encontrada' }, 404);
    } catch (err) {
      return json({ error: err.message }, 500);
    }
  }
};

async function callClaude(env, system, prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`API Anthropic ${res.status}: ${detail.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = (data.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  const clean = text.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(clean);
  } catch {
    throw new Error('IA retornou formato inesperado: ' + clean.slice(0, 200));
  }
}
