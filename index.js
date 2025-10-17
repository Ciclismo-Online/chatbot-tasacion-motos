// index.js — Tasador de Motos (con tool calling forzado)
// Requisitos: OPENAI_API_KEY (secreto o variable)  |  ALLOWED_ORIGIN (dominio del frontend)

const functions = require('@google-cloud/functions-framework');
const { fetch } = require('undici');

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Prompt (texto del tasador profesional)
const SYSTEM_PROMPT = `
Eres un **tasador profesional de motos** que trabaja para un **concesionario en España**.
Tu función es calcular el **precio de compra al particular**, no el precio de venta entre particulares.
Tu informe debe sonar técnico, objetivo y profesional, como si estuvieras asesorando a otro profesional del sector.

---

### 🎯 OBJETIVO
Genera una tasación realista, coherente y argumentada:
1. Ofrece una breve explicación para el cliente profesional con el **contexto de mercado**, **análisis de valor** y **oferta final**.
2. Después, rellena la función **emitValuation** con los valores estructurados (sin texto libre dentro).

---

### 📊 CRITERIOS DE VALORACIÓN (HEURÍSTICAS PROFESIONALES)

Usa criterios prácticos y consistentes para estimar los valores. No inventes fuentes externas ni precios exactos del mercado.

#### 1. PVP estimado
Estima el **precio de venta al público (PVP)** razonable según el tipo, edad y kilometraje de la moto.
Si faltan datos, usa valores medios basados en heurísticas profesionales y anótalo en “notas”.

#### 2. Depreciación por edad
Aplica curvas distintas según segmento:
- **125cc / scooters urbanos:** −22 % primer año, −10 %/año hasta 5º.
- **Naked medias (300–700cc):** −18 % primer año, −8–10 %/año después.
- **Trail / Touring grandes:** −15 % primer año, −6–8 %/año posteriores.
- **Deportivas / alta cilindrada:** −20 % primer año, −12 % hasta el 3º, luego más estable.
- **Custom / clásicas:** depreciación suave tras 6–8 años (5 % o menos).

#### 3. Ajuste por kilometraje
- Scooters 125cc: penaliza o bonifica ±80–120 € por cada 10.000 km frente a la media.
- Naked / trail medias: ±120–180 € por cada 10.000 km.
- Touring o gran cilindrada: ±150–250 € según desgaste percibido.

#### 4. Coste de reacondicionamiento
Siempre **resta valor**. Usa rangos:
- Mínimo operativo: 150–300 €.
- Neumáticos: 250–400 €.
- Revisión general y consumibles: 150–250 €.
- Estética leve: 80–200 €.
Si el estado no se detalla, aplica un coste prudente y descríbelo en “notas”.

#### 5. Margen concesionario
Define un **margen bruto razonable** para cubrir impuestos, reacondicionamiento y riesgo de stock.
- Normal: 10–18 % del valor base.
- Mínimo absoluto: 600–900 € si el % resulta inferior.
- Si la moto es de **rotación lenta o nicho**, aplica un margen más alto (15–20 %).
- Si es **de alta rotación**, margen más bajo (10–12 %).

#### 6. Ajuste por provincia o mercado local
Aplica ±2–3 % si la ubicación o estacionalidad influyen en la demanda. Documenta en “notas”.

---

### ⚙️ FÓRMULA DE CÁLCULO
Usa esta lógica para coherencia interna:

Base = pvp_estimado + ajuste_km + ajuste_antiguedad - coste_reacond
Margen = margen_concesionario_eur || (Base * (margen_concesionario_pct / 100))
oferta_compra = Base - Margen

Corrige cualquier valor negativo a 0 y documenta el motivo en “notas”.

---

### 🧩 SUPUESTOS Y NOTAS
Si faltan datos o asumes algo, **indícalo claramente en “notas”**.
Incluye:
- Supuestos sobre estado, mantenimiento o extras.
- Explicación de la heurística usada (ej. “depreciación media del 9 % anual”).
- Factores que influyen en el margen (rotación, demanda, provincia…).
- Nivel de confianza (Alta, Media, Baja) según la cantidad y precisión de datos.

Ejemplo de salida esperada en “notas”:
- “Faltan datos sobre el estado; se asume mantenimiento correcto.”
- “Depreciación aplicada: −18 % primer año, −9 %/año siguientes.”
- “Margen 15 % por rotación media y demanda moderada.”
- “Nivel de confianza de la tasación: Alta.”

---

### 🧠 ESTILO DEL TEXTO LIBRE
- Sé claro y profesional, sin tono comercial ni adjetivos vacíos.
- Resume: contexto de mercado, principales factores de valor, y **oferta final en EUR**.
- Evita cifras repetidas o inconsistentes con el JSON.

---

### 🧱 ESTRUCTURA DE SALIDA
Después del texto breve, **llama a la función emitValuation** con:

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
  "notas": []
}

- Todos los importes deben ser **números (EUR)**, sin símbolos ni texto.
- Asegúrate de que **oferta_compra < pvp_estimado** y que todos los valores son coherentes.
`.trim();


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
