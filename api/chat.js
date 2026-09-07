import { readFileSync } from 'fs';
import { join } from 'path';

export const config = {
  maxDuration: 60
};

function normalizar(texto) {
  return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { mensaje, historial = [] } = req.body || {};
  if (!mensaje) return res.status(400).json({ error: 'Falta el mensaje.' });

  // Recibimos las 3 llaves y la estrategia desde el frontend
  const keyGemini = req.headers['x-gemini-key'] || process.env.GEMINI_API_KEY;
  const keyGroq = req.headers['x-groq-key'] || process.env.GROQ_API_KEY;
  const keyOpenRouter = req.headers['x-openrouter-key'] || process.env.OPENROUTER_API_KEY;
  const estrategia = req.headers['x-strategy'] || 'auto'; // 'auto', 'gemini', 'groq', 'openrouter'

  if (!keyGemini && !keyGroq && !keyOpenRouter) {
    return res.status(400).json({ error: 'Configura al menos una API Key en los ajustes (⚙️).' });
  }

  try {
    const filePath = join(process.cwd(), 'campanas.json');
    const todasLasCampanas = JSON.parse(readFileSync(filePath, 'utf8'));
    const queryNorm = normalizar(mensaje);

    // 1. DICCIONARIO DE BÚSQUEDA SEMÁNTICA
    const terminosRelevantes = [];
    if (queryNorm.includes('termograf') || queryNorm.includes('calor') || queryNorm.includes('infrarroj')) terminosRelevantes.push('termograf', 'termic', 'thermal', 'infrarroj', 'infrared', 'eva clinic', 'untouchables');
    if (queryNorm.includes('cancer') || queryNorm.includes('mama') || queryNorm.includes('tumor')) terminosRelevantes.push('cancer', 'breast', 'oncolog', 'untouchables');
    if (queryNorm.includes('gaming') || queryNorm.includes('videojuego') || queryNorm.includes('esports')) terminosRelevantes.push('gaming', 'videojuego', 'esports', 'twitch', 'gamer', 'stevenage', 'fortnite');
    if (queryNorm.includes('halloween') || queryNorm.includes('terror') || queryNorm.includes('miedo')) terminosRelevantes.push('halloween', 'terror', 'miedo', 'horror', 'thriller');

    // 2. KEYWORDS Y SCORING
    const palabrasProhibidas = new Set(['para', 'como', 'este', 'esta', 'campanas', 'versus', 'piezas', 'ganaron', 'hacer', 'unas', 'unos', 'sobre', 'entre', 'base', 'datos', 'links', 'link', 'dame', 'quiero', 'existe', 'alguna', 'nada', 'seguro', 'cannes', 'lions']);
    const keywords = queryNorm.replace(/[^\w\s]/gi, '').split(/\s+/).filter(w => w.length > 3 && !palabrasProhibidas.has(w));
    const aniosDetectados = queryNorm.match(/\b(20\d{2})\b/g) || [];
    const festivales = ['cannes', 'el ojo', 'clio', 'd&ad', 'eurobest'].filter(f => queryNorm.includes(f));

    const calificadas = todasLasCampanas.map(c => {
      let score = 0;
      const metales = normalizar(c.METAL_SUMMARY || c.METAL);
      const titulo = normalizar(c.Title || c.TITULO_PIEZA);
      const marca = normalizar(c.MARCA);
      const board = normalizar(c['ANALISIS BOARD']);

      terminosRelevantes.forEach(t => {
        if (titulo.includes(t)) score += 500;
        if (board.includes(t)) score += 400;
        if (marca.includes(t)) score += 300;
      });

      keywords.forEach(kw => {
        if (titulo.includes(kw)) score += 100;
        if (marca.includes(kw)) score += 80;
        if (board.includes(kw)) score += 50;
      });

      if (aniosDetectados.includes(String(c.AÑO || c.ANIO))) score += 30;
      festivales.forEach(f => { if (normalizar(c.FESTIVAL).includes(f)) score += 20; });
      if (metales.includes('grand prix')) score += 15;
      else if (metales.includes('gold')) score += 10;

      if (queryNorm.includes('rechazad') || queryNorm.includes('no gan')) {
        if (metales.includes('no gano') && !metales.includes('grand prix') && !metales.includes('gold')) score += 60;
      }
      return { ...c, _score: score };
    });

    calificadas.sort((a, b) => b._score - a._score);
    const seleccionadas = calificadas.slice(0, 12);

    // 3. CONTEXTO DINÁMICO
    const baseSintetizada = seleccionadas.map((c, i) => {
      const titulo = String(c.Title || c.TITULO_PIEZA || 'S/T');
      const marca = String(c.MARCA || 'S/M');
      const fest = `${String(c.FESTIVAL || 'CANNES')} ${String(c.AÑO || c.ANIO || '')}`.trim();
      const metales = String(c.METAL_SUMMARY || c.METAL || 'NO GANO');
      const linkBoard = c['Board image'] || c.URL || c.LINK || c.board_image || 'No disponible';
      
      let board = String(c['ANALISIS BOARD'] || '').replace(/\s+/g, ' ').trim();
      const maxChars = i < 3 ? 1200 : 300;
      if (board.length > maxChars) board = board.substring(0, maxChars) + '...';

      return `--- CASO #${i + 1} ---\nTITULO: "${titulo}"\nMARCA: ${marca}\nFESTIVAL: ${fest}\nMETALES: ${metales}\nLINK: ${linkBoard}\nBOARD: ${board}\n-------------------`;
    }).join('\n\n');

    const promptSistema = `
Eres un riguroso auditor de festivales publicitarios. Analiza los datos de la base.

BASE EXTRACTADA (12 CASOS):
${baseSintetizada}

REGLAS DE METALES:
- "Grand Prix", "Gold", "Silver", "Bronze": Ganadoras comprobadas.
- "Shortlist": Pasó la primera ronda pero NO ganó metal.
- "NO GANO": ELIMINADA / RECHAZADA. No entró ni a Shortlist.

REGLAS ESTRICTAS (ANTI-ALUCINACIONES):
1. BÁSATE EXCLUSIVAMENTE EN LA INFORMACIÓN PROVISTA.
2. Si preguntan por un tema y NO está en los 12 casos, RESPONDE: "No encontré campañas registradas con esas características en la base actual". PROHIBIDO inventar.
3. Si piden enlaces, usa Markdown: [Ver Board Oficial](URL).
`;

    // Preparar historiales para los diferentes formatos
    const historialLargo = historial.slice(-30);
    const mensajesOpenAI = [
      { role: 'system', content: promptSistema },
      ...historialLargo,
      { role: 'user', content: mensaje }
    ];
    
    const historialGemini = historialLargo.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    }));
    const payloadGemini = {
      contents: [...historialGemini, { role: 'user', parts: [{ text: `${promptSistema}\n\nConsulta actual: ${mensaje}` }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 2000 }
    };

    // 4. MOTORES DE IA (Funciones de llamada)
    async function llamarGemini() {
      if (!keyGemini) throw new Error('Key de Gemini no configurada');
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${keyGemini}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payloadGemini)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Error Gemini');
      return data.candidates?.[0]?.content?.parts?.[0]?.text;
    }

    async function llamarGroq() {
      if (!keyGroq) throw new Error('Key de Groq no configurada');
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', headers: { 'Authorization': `Bearer ${keyGroq}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'llama3-70b-8192', messages: mensajesOpenAI, temperature: 0.2, max_tokens: 2000 })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Error Groq');
      return data.choices?.[0]?.message?.content;
    }

    async function llamarOpenRouter() {
      if (!keyOpenRouter) throw new Error('Key de OpenRouter no configurada');
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', headers: { 'Authorization': `Bearer ${keyOpenRouter}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://festival-ai.vercel.app', 'X-Title': 'Festival AI' },
        body: JSON.stringify({ model: 'qwen/qwen-2.5-72b-instruct:free', messages: mensajesOpenAI, temperature: 0.35, presence_penalty: 0.4, max_tokens: 2000 })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Error OpenRouter');
      return data.choices?.[0]?.message?.content;
    }

    // 5. LÓGICA DE RUTEO (WATERFALL FALLBACK)
    let respuestaTexto = null;

    if (estrategia === 'auto') {
      try {
        respuestaTexto = await llamarGemini();
      } catch (err1) {
        console.warn('Gemini falló, intentando Groq...', err1.message);
        try {
          respuestaTexto = await llamarGroq();
        } catch (err2) {
          console.warn('Groq falló, intentando OpenRouter...', err2.message);
          respuestaTexto = await llamarOpenRouter();
        }
      }
    } else if (estrategia === 'gemini') { respuestaTexto = await llamarGemini(); }
    else if (estrategia === 'groq') { respuestaTexto = await llamarGroq(); }
    else if (estrategia === 'openrouter') { respuestaTexto = await llamarOpenRouter(); }

    if (!respuestaTexto) return res.status(500).json({ error: 'Todos los proveedores fallaron o devolvieron respuestas vacías.' });

    return res.status(200).json({ respuesta: respuestaTexto });

  } catch (error) {
    console.error('Error general:', error);
    return res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
}
