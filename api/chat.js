import { readFileSync } from 'fs';
import { join } from 'path';

export const config = {
  maxDuration: 60
};

function normalizar(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { mensaje, historial = [] } = req.body || {};
  if (!mensaje) return res.status(400).json({ error: 'Falta el mensaje en la consulta.' });

  const keyGemini = process.env.GEMINI_API_KEY || req.headers['x-gemini-key'];
  const keyGroq = process.env.GROQ_API_KEY || req.headers['x-groq-key'];
  const keyOpenRouter = process.env.OPENROUTER_API_KEY || req.headers['x-openrouter-key'];
  const estrategia = req.headers['x-strategy'] || 'auto'; 

  if (!keyGemini && !keyGroq && !keyOpenRouter) {
    return res.status(500).json({ error: 'Faltan las variables de entorno (API Keys) en Vercel.' });
  }

  try {
    const filePath = join(process.cwd(), 'campanas.json');
    const todasLasCampanas = JSON.parse(readFileSync(filePath, 'utf8'));

    // CLAVE DE MEMORIA: Expandir la consulta con los turnos previos para no perder la campaña activa
    const ultimosTurnosUsuario = historial
      .filter(m => m.role === 'user')
      .slice(-2)
      .map(m => m.content)
      .join(' ');
    
    const queryCompuesta = `${ultimosTurnosUsuario} ${mensaje}`;
    const queryNorm = normalizar(queryCompuesta);

    // 1. EXPANSIÓN SEMÁNTICA
    const terminosRelevantes = [];
    if (queryNorm.includes('termograf') || queryNorm.includes('calor') || queryNorm.includes('infrarroj')) terminosRelevantes.push('termograf', 'termic', 'thermal', 'infrarroj', 'infrared', 'eva clinic', 'untouchables');
    if (queryNorm.includes('cancer') || queryNorm.includes('mama') || queryNorm.includes('tumor')) terminosRelevantes.push('cancer', 'breast', 'oncolog', 'untouchables');
    if (queryNorm.includes('gaming') || queryNorm.includes('videojuego') || queryNorm.includes('esports')) terminosRelevantes.push('gaming', 'videojuego', 'esports', 'twitch', 'gamer', 'stevenage', 'fortnite');
    if (queryNorm.includes('halloween') || queryNorm.includes('terror') || queryNorm.includes('miedo')) terminosRelevantes.push('halloween', 'terror', 'miedo', 'horror', 'thriller');

    // 2. SCORING INTELIGENTE
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

    // 3. GENERACIÓN DE CONTEXTO
    const baseSintetizada = seleccionadas.map((c, i) => {
      const titulo = String(c.Title || c.TITULO_PIEZA || 'S/T');
      const marca = String(c.MARCA || 'S/M');
      const fest = `${String(c.FESTIVAL || 'CANNES')} ${String(c.AÑO || c.ANIO || '')}`.trim();
      const metales = String(c.METAL_SUMMARY || c.METAL || 'NO GANO');
      const linkBoard = c['Board image'] || c.URL || c.LINK || c.board_image || 'No disponible';
      
      let board = String(c['ANALISIS BOARD'] || '').replace(/\s+/g, ' ').trim();
      const maxChars = i < 3 ? 1500 : 300; 
      if (board.length > maxChars) board = board.substring(0, maxChars) + '...';

      return `--- CASO #${i + 1} ---\nTITULO: "${titulo}"\nMARCA: ${marca}\nFESTIVAL: ${fest}\nMETALES: ${metales}\nLINK: ${linkBoard}\nBOARD: ${board}\n-------------------`;
    }).join('\n\n');

    const promptSistema = `
Eres un riguroso auditor de festivales publicitarios. Analiza los datos de la base manteniendo estricta coherencia con las preguntas anteriores del usuario.

BASE EXTRACTADA (12 CASOS):
${baseSintetizada}

REGLAS DE METALES:
- "Grand Prix", "Gold", "Silver", "Bronze": Ganadoras comprobadas.
- "Shortlist": Pasó la primera ronda pero NO ganó metal.
- "NO GANO": ELIMINADA / RECHAZADA. No entró ni a Shortlist.

REGLAS ESTRICTAS:
1. BÁSATE EXCLUSIVAMENTE EN LA INFORMACIÓN PROVISTA.
2. Si preguntan por un tema y NO está en los casos, responde que no hay campañas registradas con esas características.
3. Si el usuario hace repreguntas de seguimiento (ej. "¿y qué debilidad tuvo?", "¿qué marca era?", "¿quién fue la agencia?"), identifica a qué caso del historial se refiere y responde con exactitud.
4. Si piden enlaces, usa Markdown: [Ver Board Oficial](URL).
`;

    // 4. SANEO ESTRICTO DE HISTORIAL
    const historialLargo = historial.slice(-20);
    
    // Mensajes para OpenAI / Groq / OpenRouter
    const mensajesOpenAI = [
      { role: 'system', content: promptSistema },
      ...historialLargo,
      { role: 'user', content: mensaje }
    ];

    // Saneamiento para Gemini (debe alternar user -> model sin duplicados continuos)
    const historialGemini = [];
    let ultimoRol = null;
    
    for (const msg of historialLargo) {
      const rolActual = msg.role === 'assistant' ? 'model' : 'user';
      if (rolActual !== ultimoRol) {
        historialGemini.push({
          role: rolActual,
          parts: [{ text: String(msg.content) }]
        });
        ultimoRol = rolActual;
      }
    }

    // Asegurar que comience con 'user' si hay historial
    if (historialGemini.length > 0 && historialGemini[0].role === 'model') {
      historialGemini.shift();
    }

    const modelosGemini = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash'];
    const modelosGroq = ['groq/compound', 'groq/compound-mini', 'llama3-70b-8192', 'llama3-8b-8192', 'mixtral-8x7b-32768'];
    const modelosOpenRouter = ['google/gemma-4-31b:free', 'nvidia/nemotron-3-ultra:free', 'poolside/laguna-s-2.1:free', 'thinkingmachines/inkling:free', 'cohere/north-mini-code:free'];

    async function rotarGemini() {
      if (!keyGemini) throw new Error('Key Gemini ausente');
      for (const modelo of modelosGemini) {
        try {
          const payload = {
            contents: [
              ...historialGemini,
              { role: 'user', parts: [{ text: `${promptSistema}\n\nConsulta actual: ${mensaje}` }] }
            ],
            generationConfig: { temperature: 0.2, maxOutputTokens: 2000 }
          };
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${keyGemini}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
          });
          const data = await res.json();
          if (res.ok && data.candidates?.[0]?.content?.parts?.[0]?.text) {
            return data.candidates[0].content.parts[0].text;
          }
        } catch (e) {
          console.warn(`Gemini (${modelo}) falló, probando siguiente...`);
        }
      }
      throw new Error('Todos los modelos de Gemini fallaron.');
    }

    async function rotarGroq() {
      if (!keyGroq) throw new Error('Key Groq ausente');
      for (const modelo of modelosGroq) {
        try {
          const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST', headers: { 'Authorization': `Bearer ${keyGroq}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: modelo, messages: mensajesOpenAI, temperature: 0.2, max_tokens: 2000 })
          });
          const data = await res.json();
          if (res.ok && data.choices?.[0]?.message?.content) {
            return data.choices[0].message.content;
          }
        } catch (e) {
          console.warn(`Groq (${modelo}) falló, probando siguiente...`);
        }
      }
      throw new Error('Todos los modelos de Groq fallaron.');
    }

    async function rotarOpenRouter() {
      if (!keyOpenRouter) throw new Error('Key OpenRouter ausente');
      for (const modelo of modelosOpenRouter) {
        try {
          const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST', headers: { 
              'Authorization': `Bearer ${keyOpenRouter}`, 
              'Content-Type': 'application/json', 
              'HTTP-Referer': 'https://festival-ai.vercel.app', 
              'X-Title': 'Festival AI' 
            },
            body: JSON.stringify({ 
              model: modelo, 
              messages: mensajesOpenAI, 
              temperature: 0.35, 
              presence_penalty: 0.4, 
              max_tokens: 2000 
            })
          });
          const data = await res.json();
          if (res.ok && data.choices?.[0]?.message?.content) {
            return data.choices[0].message.content;
          }
        } catch (e) {
          console.warn(`OpenRouter (${modelo}) falló, probando siguiente...`);
        }
      }
      throw new Error('Todos los modelos de OpenRouter fallaron.');
    }

    let respuestaTexto = null;

    if (estrategia === 'auto') {
      try {
        respuestaTexto = await rotarGemini();
      } catch (err1) {
        try {
          respuestaTexto = await rotarGroq();
        } catch (err2) {
          try {
            respuestaTexto = await rotarOpenRouter();
          } catch (err3) {
            throw new Error(`Cascada colapsada globalmente.`);
          }
        }
      }
    } else if (estrategia === 'gemini') { respuestaTexto = await rotarGemini(); }
    else if (estrategia === 'groq') { respuestaTexto = await rotarGroq(); }
    else if (estrategia === 'openrouter') { respuestaTexto = await rotarOpenRouter(); }

    if (!respuestaTexto) return res.status(500).json({ error: 'Respuesta vacía de los modelos.' });

    return res.status(200).json({ respuesta: respuestaTexto });

  } catch (error) {
    console.error('Error general:', error);
    return res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
}
