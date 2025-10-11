// index.js — Chatbot Tasador de Motos (versión final)
// Requisitos: OPENAI_API_KEY en variables o secretos
// npm i @google-cloud/functions-framework undici

const functions = require('@google-cloud/functions-framework');
const { fetch } = require('undici');

// Configuración
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Prompt especializado
const SYSTEM_PROMPT = `
Rol y Objetivo:
Eres un tasador profesional de motocicletas que trabaja para una red de concesionarios multimarca en España.
Calculas el valor de compra (trade-in) para el concesionario, no el precio entre particulares.

Instrucciones de tasación:
1) Normaliza marca, modelo, versión, año y kms.
2) Estima un PVP de reventa medio en España.
3) Aplica ajustes por kms y antigüedad.
4) Calcula coste de reacondicionamiento (revisión, consumibles, neumáticos si procede).
5) Aplica margen concesionario entre 20% y 35% según rotación/demanda/estado.
6) Devuelve un precio de compra estimado para el concesionario.

Formato de salida:
- Primero, texto claro con:
  • Resumen (marca, modelo, versión, año, kms)
  • Análisis breve del mercado
  • Desglose: PVP estimado, reacondicionamiento, margen
  • Oferta de compra final (EUR)
  • Nota: oferta sujeta a inspección física y documentación

- Después, devuelve SOLO un bloque JSON válido con esta estructura EXACTA (sin usar etiquetas de código ni \`\`\`json\`\`\`):

{
  "resumen": { "marca": "", "modelo": "", "version": "", "ano": 0, "kms": 0 },
  "estimaciones": {
    "pvp_estimado": 0,
    "ajuste_km": 0,
    "ajuste_antiguedad": 0,
    "coste_reacond": 0,
    "margen_concesionario_pct": 0,
    "margen_concesionario_eur": 0
  },
  "oferta_compra": 0,
  "supuestos": { "estado": "", "extras": "", "provincia": "" },
  "notas": ["..."]
}

Asegúrate de que todos los importes sean números (no strings) y que el JSON sea válido.
No uses bloques de código ni etiquetas. Devuelve SOLO el objeto JSON, sin texto antes ni después.
`;

// Helper para construir el mensaje del usuario
function buildUserMessageFromStruct(body) {
  const {
    marca = '',
    modelo = '',
    version = '',
    ano = '',
    kms = '',
    estado = '',
    extras = '',
    provincia = ''
  } = body || {};

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

Devuélveme la valoración siguiendo exactamente el formato pedido (texto + JSON).
`.trim();
}

// 🔍 Función para extraer el JSON del texto del modelo
function extractJSON(text) {
  if (typeof text !== "string") return null;

  // 1️⃣ Elimina cualquier bloque de código tipo ```json ... ```
  let cleaned = text.replace(/```(?:json)?/gi, "").replace(/```/g, "");

  // 2️⃣ Busca el último objeto JSON válido
  const start = cleaned.lastIndexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;

  const jsonCandidate = cleaned.slice(start, end + 1).trim();

  // 3️⃣ Intenta parsear
  try {
    return JSON.parse(jsonCandidate);
  } catch {
    // 4️⃣ Si falla, intenta corregir saltos de línea o comillas
    try {
      const fixed = jsonCandidate
        .replace(/\r?\n|\r/g, " ")
        .replace(/\s{2,}/g, " ")
        .replace(/“|”/g, '"');
      return JSON.parse(fixed);
    } catch {
      console.warn("⚠️ No se pudo parsear JSON de la respuesta del modelo.");
      return null;
    }
  }
}


// 🧠 Función principal HTTP
functions.http('chatbotTasadorHandler', async (req, res) => {
  // Configurar CORS
  res.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).send('');

  try {
    if (!OPENAI_API_KEY) throw new Error('Falta la variable OPENAI_API_KEY.');

    const { chatHistory, ...body } = req.body || {};
    const messages = [{ role: 'system', content: SYSTEM_PROMPT }];

    if (Array.isArray(chatHistory) && chatHistory.length > 0) {
      messages.push(...chatHistory);
    } else {
      const userContent = buildUserMessageFromStruct(body);
      messages.push({ role: 'user', content: userContent });
    }

    // Llamada a OpenAI
    const completion = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        temperature: 0.3,
        max_tokens: 900,
        messages
      })
    });

    const data = await completion.json();

    if (!completion.ok) {
      throw new Error(data?.error?.message || `Error HTTP ${completion.status}`);
    }

    const content = data?.choices?.[0]?.message?.content || '';
    const valuation = extractJSON(content);

    res.status(200).send({
      success: true,
      responseText: content,
      valuation: valuation || null
    });
  } catch (err) {
    console.error('❌ Error en chatbotTasadorHandler:', err.message);
    res.status(500).send({
      success: false,
      error: 'SERVER_ERROR',
      message: err.message
    });
  }
});
