import { readFileSync } from 'fs';
import { join } from 'path';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { mensaje } = req.body || {};
  if (!mensaje) {
    return res.status(400).json({ error: 'Falta el mensaje en la consulta.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Falta configurar GEMINI_API_KEY en Vercel.' });
  }

  try {
    const filePath = join(process.cwd(), 'campanas.json');
    const fileData = readFileSync(filePath, 'utf8');
    const todasLasCampanas = JSON.parse(fileData);

    // Mapeo estructurado y compacto de los casos
    const baseSintetizada = todasLasCampanas.map((c, i) => {
      const metal = (c.METAL || c.metal || 'SHORTLIST / NO GANADORA').toUpperCase();
      const pieza = c.TITULO_PIEZA || c.titulo_pieza || 'Sin título';
      const marca = c.MARCA || c.marca || 'Sin marca';
      const fest = `${c.FESTIVAL || c.festival || 'Cannes'} ${c.ANIO || c.anio || ''}`.trim();
      const ins = (c.insight_problema || c.insight || '').replace(/\s+/g, ' ').trim();
      const ide = (c.idea_ejecucion || c.idea || '').replace(/\s+/g, ' ').trim();
      const url = c.LINK || c.link || '';

      return `${i + 1}. [${metal}] "${pieza}" (${marca} - ${fest}) | INSIGHT: ${ins} | IDEA: ${ide}${url ? ` | LINK: ${url}` : ''}`;
    }).join('\n');

    const promptSistema = `
Eres un analista estratégico y director creativo senior de festivales publicitarios. 
Tienes acceso a una base de datos de 300 campañas (ganadoras de metales altos y piezas que quedaron en shortlist o no ganaron):

=== REGISTRO DE CASOS ===
${baseSintetizada}
=========================

REGLAS DE INTERACCIÓN (CUMPLIMIENTO ESTRICTO):
1. PROHIBIDO EL ROLEPLAY teatral, las acotaciones entre paréntesis (tipo *hago esto*), las poses y los monólogos sobre actuar como jurado. Habla de forma directa, inteligente, reflexiva y colaborativa.
2. PROFUNDIDAD ANALÍTICA REAL: Cuando analices por qué una campaña ganó frente a las que no ganaron, haz autopsias detalladas y fundamentadas en los datos del registro.
   - Desmenuza la tensión: Compara la fricción cultural real de una ganadora contra la obviedad temática de una no ganadora.
   - Desmenuza la mecánica: Explica si la idea fue un truco cosmético aislado o una solución integrada al producto/cultura.
3. CONTRASTE 1 A 1 CON DATOS: Cita obligatoriamente por su nombre y marca al menos 2 casos ganadores y 2 casos no ganadores de la lista para mostrar la brecha estratégica exacta entre ambos.
4. Cierra siempre con una pregunta estratégica abierta sobre el problema o brief que estamos resolviendo para continuar rebotando ideas.
`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${apiKey}`;

    const payload = {
      contents: [
        {
          role: 'user',
          parts: [{ text: `${promptSistema}\n\nConsulta/Brief: ${mensaje}` }]
        }
      ],
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 2048
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      const err = data.error?.message || response.statusText;
      return res.status(500).json({ error: `Error de la API: ${err}` });
    }

    const respuestaTexto = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No se obtuvo respuesta.';
    return res.status(200).json({ respuesta: respuestaTexto });

  } catch (error) {
    console.error('Error general:', error);
    return res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
}
