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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { mensaje, historial = [] } = req.body || {};
  if (!mensaje) {
    return res.status(400).json({ error: 'Falta el mensaje en la consulta.' });
  }

  const headerKey = req.headers['x-user-key'];
  const userKey = (typeof headerKey === 'string' && headerKey.trim().length > 0) ? headerKey.trim() : null;
  const headerProvider = req.headers['x-user-provider'];

  const apiKey = userKey || process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(400).json({ 
      error: 'No se detectó API Key. Configúrala en el botón de ajustes (⚙️) o en Vercel.' 
    });
  }

  try {
    const filePath = join(process.cwd(), 'campanas.json');
    const fileData = readFileSync(filePath, 'utf8');
    const todasLasCampanas = JSON.parse(fileData);

    const queryNorm = normalizar(mensaje);

    const palabrasProhibidas = new Set([
      'no', 'sin', 'con', 'base', 'campana', 'festival', 'cannes', 'eurobest', 'dubai', 'lynx',
      'ideas', 'piezas', 'casos', 'versus', 'detalle', 'analisis', 'tabla', 'todas', 'links', 
      'link', 'seguro', 'nada', 'existe', 'alguna', 'sobre', 'dame'
    ]);

    const coincidenciaEspecifica = todasLasCampanas.find(c => {
      const tit = limpiarTexto(c.Title || c.TITULO_PIEZA);
      if (tit.length < 5 || palabrasProhibidas.has(tit)) return false;
      return queryNorm.includes(tit);
    });

    let promptSistema = '';
    const reglasMetalesYLinks = `
REGLAS METODOLÓGICAS:
- "Grand Prix", "Gold", "Silver", "Bronze": Ganadoras en el podio.
- "Shortlist": Superó el primer corte pero no obtuvo metal.
- "NO GANO": RECHAZADA / ELIMINADA. No entró a Shortlist. Prohibido decir que quedó en shortlist.
- ENLACES: Si el usuario pide links, imágenes o boards, entrégalos en formato Markdown: [Ver Board Oficial](URL).
`;

    if (coincidenciaEspecifica) {
      const c = coincidenciaEspecifica;
      const linkBoard = c['Board image'] || c.URL || c.LINK || c.board_image || 'No disponible';

      promptSistema = `
Eres un jurado implacable de Cannes Lions analizando este caso específico:

DATOS OFICIALES:
- Título: ${c.Title || c.TITULO_PIEZA}
- Marca: ${c.MARCA}
- Festival y Año: ${c.FESTIVAL || 'CANNES'} ${c.AÑO || c.ANIO || ''}
- Categorías: ${c.CATEGORIA_SUMMARY || c.CATEGORIA || 'No especificada'}
- Desglose de Metales: ${c.METAL_SUMMARY || c.METAL || 'NO GANO'}
- Agencia: ${c.AGENCIA || 'No especificada'}
- LINK_BOARD: ${linkBoard}
- ANÁLISIS DE BOARD COMPLETO:
${c['ANALISIS BOARD'] || 'Sin información detallada de board.'}

${reglasMetalesYLinks}

INSTRUCCIONES:
1. Sé fiel al board provisto.
2. Si el usuario pide el enlace, muestra: [Ver Board Oficial](${linkBoard}).
`;

    } else {
      const terminosRelevantes = [];
      if (queryNorm.includes('termograf') || queryNorm.includes('calor') || queryNorm.includes('infrarroj')) {
        terminosRelevantes.push('termograf', 'termic', 'thermal', 'infrarroj', 'infrared', 'untouchables', 'eva');
      }
      if (queryNorm.includes('cancer') || queryNorm.includes('mama') || queryNorm.includes('salud')) {
        terminosRelevantes.push('cancer', 'breast', 'eva clinic', 'untouchables', 'tumor');
      }

      const calificadas = todasLasCampanas.map(c => {
        let score = 0;
        const metales = normalizar(c.METAL_SUMMARY || c.METAL);
        const titulo = normalizar(c.Title || c.TITULO_PIEZA);
        const marca = normalizar(c.MARCA);
        const cat = normalizar(c.CATEGORIA_SUMMARY || c.CATEGORIA);
        const board = normalizar(c['ANALISIS BOARD']);

        terminosRelevantes.forEach(t => {
          if (titulo.includes(t)) score += 150;
          if (board.includes(t)) score += 120;
          if (marca.includes(t)) score += 80;
        });

        const tokens = queryNorm.split(/\s+/).filter(w => w.length > 3 && !palabrasProhibidas.has(w));
        tokens.forEach(tk => {
          if (titulo.includes(tk)) score += 40;
          if (marca.includes(tk)) score += 30;
          if (board.includes(tk)) score += 20;
        });

        if (metales.includes('grand prix')) score += 15;
        else if (metales.includes('gold')) score += 10;
        else if (metales.includes('silver')) score += 5;

        return { ...c, _score: score };
      });

      calificadas.sort((a, b) => b._score - a._score);
      const seleccionadas = calificadas.slice(0, 25);

      const baseSintetizada = seleccionadas.map((c, i) => {
        const titulo = String(c.Title || c.TITULO_PIEZA || 'S/T');
        const marca = String(c.MARCA || 'S/M');
        const fest = `${String(c.FESTIVAL || 'CANNES')} ${String(c.AÑO || c.ANIO || '')}`.trim();
        const metales = String(c.METAL_SUMMARY || c.METAL || 'NO GANO');
        const linkBoard = c['Board image'] || c.URL || c.LINK || c.board_image || 'No disponible';
        
        let board = String(c['ANALISIS BOARD'] || '').replace(/\s+/g, ' ').trim();
        if (board.length > 260) board = board.substring(0, 260) + '...';

        return `${i + 1}. "${titulo}" (${marca} - ${fest}) | LINK: ${linkBoard} | RESULTADOS: ${metales} | BOARD: ${board}`;
      }).join('\n\n');

      promptSistema = `
Eres un jurado estricto y analista senior de Cannes Lions.
Tienes sobre la mesa estos casos extraídos de la base de datos:

${baseSintetizada}

${reglasMetalesYLinks}

PAUTAS:
1. Revisa minuciosamente los boards provistos (incluyendo menciones en inglés o tecnología aplicada).
2. Si un caso coincide con el tema, cítalo con sus metales reales.
3. Si solicitan links, entrégalos siempre en Markdown: [Ver Board Oficial](URL).
`;
    }

    // AHORA RECUERDA HASTA 30 MENSAJES DE HISTORIAL
    const historialLargo = historial.slice(-30);
    let respuestaTexto = null;
    const esOpenRouter = apiKey.startsWith('sk-or-') || headerProvider === 'openrouter';

    if (esOpenRouter) {
      const mensajesParaLLM = [
        { role: 'system', content: promptSistema },
        ...historialLargo,
        { role: 'user', content: mensaje }
      ];

      const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://festival-ai.vercel.app',
          'X-Title': 'Festival AI'
        },
        body: JSON.stringify({
          model: 'minimax/minimax-m3:free',
          messages: mensajesParaLLM,
          temperature: 0.35,
          presence_penalty: 0.4,
          max_tokens: 2000
        })
      });

      const data = await resp.json();
      if (!resp.ok) return res.status(500).json({ error: `Error OpenRouter: ${data.error?.message || resp.statusText}` });
      respuestaTexto = data.choices?.[0]?.message?.content;

    } else {
      // Traducción de historial para Gemini
      const historialGemini = historialLargo.map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      }));

      const payload = {
        contents: [
          ...historialGemini,
          { role: 'user', parts: [{ text: `${promptSistema}\n\nConsulta actual: ${mensaje}` }] }
        ],
        generationConfig: { temperature: 0.2, maxOutputTokens: 2000 }
      };

      const urlGemini = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
      const resp = await fetch(urlGemini, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await resp.json();
      
      if (!resp.ok) {
        if (data.error?.message && data.error.message.includes('gemini-3.6-flash')) {
          const url36 = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;
          const resp36 = await fetch(url36, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data36 = await resp36.json();
          if (!resp36.ok) return res.status(500).json({ error: `Error Gemini: ${data36.error?.message}` });
          respuestaTexto = data36.candidates?.[0]?.content?.parts?.[0]?.text;
        } else {
          return res.status(500).json({ error: `Error Gemini: ${data.error?.message || resp.statusText}` });
        }
      } else {
        respuestaTexto = data.candidates?.[0]?.content?.parts?.[0]?.text;
      }
    }

    return res.status(200).json({ respuesta: respuestaTexto });

  } catch (error) {
    console.error('Error general:', error);
    return res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
}

// Función auxiliar
function limpiarTexto(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}
