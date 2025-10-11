// index.js — Tasador de Motos (con tool calling forzado)
// Requisitos: OPENAI_API_KEY (secreto o variable)  |  ALLOWED_ORIGIN (dominio del frontend)

const functions = require('@google-cloud/functions-framework');
const { fetch } = require('undici');

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Prompt (el texto puede ser libre; la estructura viene por tool_call)
const SYSTEM_PROMPT = `
Eres un tasador profesional de motos para concesionario en España.
Calculas el **precio de compra** (no de venta entre particulares).
Haz un resumen claro (mercado, desglose y oferta final) y **luego** rellena la estructura solicitada.
No inventes si faltan datos; asume valores razonables y anótalos en "notas".
`;

// Schema del objeto de tasación (lo forzamos vía tool calling)
const tools = [
  {
    type: "function",
    function: {
      name: "emitValuation",
      description: "Devuelve la valoración estructurada para que el sistema la procese.",
      parameters: {
        type: "object",
        properties: {
          resumen: {
            type: "object",
            properties: {
              marca: { type: "string" },
              modelo: { type: "string" },
              version: { type: "string" },
              ano: { type: "number" },
              kms: { type: "number" }
            },
            required: ["marca", "modelo", "version", "ano", "kms"]
          },
          estimaciones: {
            type: "object",
            properties: {
              pvp_estimado: { type: "number" },
              ajuste_km: { type: "number" },
              ajuste_antiguedad: { type: "number" },
              coste_reacond: { type: "number" },
              margen_concesionario_pct: { type: "number" },
              margen_concesionario_eur: { type: "number" }
            },
            required: [
              "pvp_estimado",
              "ajuste_km",
              "ajuste_antiguedad",
              "coste_reacond",
              "margen_concesionario_pct",
              "margen_concesionario_eur"
            ]
          },
          oferta_compra: { type: "number" },
          supuestos: {
            type: "object",
            properties: {
              estado: { type: "string" },
              extras: { type: "string" },
              provincia: { type: "string" }
            },
            required: ["estado", "extras", "provincia"]
          },
          notas: { type: "array", items: { type: "string" } }
        },
        required: ["resumen", "estimaciones", "oferta_compra", "supuestos", "notas"],
        additionalProperties: false
      }
    }
  }
];

// Mensaje de usuario a partir del body
function buildUserMessage(body = {}) {
  const {
    marca = "", modelo = "", version = "",
    ano = "", kms = "", estado = "", extras = "", provincia = ""
  } = body;

  return `
Tasación solicitada:
- Marca: ${marca}
- Modelo: ${modelo}
- Versión: ${version}
- Año: ${ano}
- Kilómetros: ${kms}
- Estado: ${estado}
- Extras: ${extras}
- Provincia: ${provincia}

Instrucciones:
1) Escribe un texto breve para el cliente con: resumen, análisis de mercado, desglose y oferta final (EUR).
2) A continuación, **rellena la función emitValuation** con números (no strings) y euros como enteros/decimales.
`.trim();
}

// Fallback: intentar extraer JSON si no hubiese tool call (no debería pasar)
function extractJSON(text) {
  if (typeof text !== "string") return null;
  let cleaned = text.replace(/```(?:json)?/gi, "").replace(/```/g, "");
  const start = cleaned.lastIndexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  const candidate = cleaned.slice(start, end + 1).trim();
  try { return JSON.parse(candidate); } catch {
    try {
      const fixed = candidate
        .replace(/\r?\n|\r/g, " ")
        .replace(/\s{2,}/g, " ")
        .replace(/“|”/g, '"');
      return JSON.parse(fixed);
    } catch { return null; }
  }
}

functions.http('chatbotTasadorHandler', async (req, res) => {
  // CORS
  res.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).send('');

  try {
    if (!OPENAI_API_KEY) throw new Error('Falta OPENAI_API_KEY.');

    const { chatHistory, ...payload } = req.body || {};
    const messages = [{ role: 'system', content: SYSTEM_PROMPT }];

    if (Array.isArray(chatHistory) && chatHistory.length) {
      messages.push(...chatHistory);
    } else {
      messages.push({ role: 'user', content: buildUserMessage(payload) });
    }

    // Llamada a OpenAI forzando tool_call a "emitValuation"
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        temperature: 0.3,
        max_tokens: 1000,
        messages,
        tools,
        tool_choice: { type: "function", function: { name: "emitValuation" } }
      })
    });

    const data = await resp.json();
    if (!resp.ok) throw new Error(data?.error?.message || `HTTP ${resp.status}`);

    const msg = data?.choices?.[0]?.message || {};
    const responseText = (msg.content || "").toString();

    // 1) Preferimos la tool call (estructurado garantizado)
    let valuation = null;
    const tc = msg.tool_calls?.[0];
    if (tc?.function?.name === 'emitValuation' && tc?.function?.arguments) {
      try {
        valuation = JSON.parse(tc.function.arguments);
      } catch (e) {
        // Si por lo que sea viniese mal formateado, fallback a extractor
        valuation = extractJSON(tc.function.arguments);
      }
    }

    // 2) Fallback: intentar sacar JSON del texto
    if (!valuation) valuation = extractJSON(responseText);

    res.status(200).send({
      success: true,
      responseText,
      valuation: valuation || null
    });
  } catch (err) {
    console.error('Tasador ERROR:', err);
    res.status(500).send({ success: false, error: 'SERVER_ERROR', message: err.message });
  }
});
