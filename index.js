// index.js — Chatbot Tasador de Motos (MVP, sin BD)
// Requisitos: OPENAI_API_KEY en variables de entorno
// npm scripts: "start": "functions-framework --target=chatbotTasadorHandler --port=8080"

const functions = require('@google-cloud/functions-framework');
const { fetch } = require('undici');

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Prompt profesional (concesionario en España)
const SYSTEM_PROMPT = `
Rol y Objetivo:
Eres un tasador de motocicletas profesional que trabaja para una red de concesionarios multimarca en España.
Calculas el valor de compra (trade-in) para un concesionario, no el precio entre particulares.

Instrucciones de tasación:
1) Normaliza marca, modelo, versión, año y kms.
2) Estima un PVP de reventa medio en España (orientativo).
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
- Después, SOLO un bloque JSON válido:
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
Asegúrate de que el JSON sea válido y todos los importes estén en número (EUR).
`;

functions.http('chatbotTasadorHandler', async (req, res) => {
  // CORS
  res.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).send('');

  try {
    if (!OPENAI_API_KEY) throw new Error('Falta OPENAI_API_KEY en variables de entorno.');

    const { chatHistory, marca, modelo, version, ano, kms, estado, extras, provincia } = req.body || {};

    // Construimos mensajes: o chatHistory, o entrada estructurada
    const messages = [{ role: 'system', content: SYSTEM_PROMPT }];

    if (Array.isArray(chatHistory) && chatHistory.length) {
      messages.push(...chatHistory);
    } else {
      const user = `
Tasación solicitada:
- Marca: ${marca ?? ''}
- Modelo: ${modelo ?? ''}
- Versión: ${version ?? ''}
- Año: ${ano ?? ''}
- Kilómetros: ${kms ?? ''}
- Estado: ${estado ?? ''}
- Extras: ${extras ?? ''}
- Provincia: ${provincia ?? ''}

Devuélveme la valoración siguiendo exactamente el formato pedido (texto + JSON).
`.trim();
      messages.push({ role: 'user', content: user });
    }

    // Llamada a OpenAI
    const completion = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o', temperature: 0.3, max_tokens: 900, messages })
    });
    const data = await completion.json();
    if (!completion.ok) throw new Error(data?.error?.message || `HTTP ${completion.status}`);

    const content = data?.choices?.[0]?.message?.content || '';

    // Intentamos extraer el último bloque JSON de la respuesta
    const valuation = extractJSON(content);

    res.status(200).send({
      success: true,
      responseText: content,
      valuation: valuation || null
    });
  } catch (e) {
    console.error('Error:', e?.message);
    res.status(500).send({ success: false, error: 'SERVER_ERROR', message: e?.message || 'Error desconocido' });
  }
});

// Extrae el último bloque JSON de un texto
function extractJSON(text) {
  if (typeof text !== 'string') return null;
  const open = text.lastIndexOf('{');
  const close = text.lastIndexOf('}');
  if (open === -1 || close === -1 || close < open) return null;
  try { return JSON.parse(text.slice(open, close + 1)); } catch { return null; }
}
