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

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Falta configurar OPENROUTER_API_KEY en Vercel.' });
  }

  try {
    const filePath = join(process.cwd(), 'campanas.json');
    const fileData = readFileSync(filePath, 'utf8');
    const todasLasCampanas = JSON.parse(fileData);

    // Formato sintetizado (~12k tokens)
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
Eres un analista estratégico y director creativo senior de festivales como Cannes Lions.
Tienes sobre la mesa un archivo de 300 campañas (metales pesados frente a shortlists y no ganadoras):

=== BASE DE CAMPAÑAS ===
${baseSintetizada}
========================

INSTRUCCIONES CLAVE:
1. PROHIBIDO EL TEATRO O ROLEPLAY: Cero acotaciones entre paréntesis (tipo *te miro*, *suspiro*). Habla como un colega creativo directo, reflexivo y certero.
2. ANÁLISIS DE FONDO:
   - Diferencia la fricción cultural real de una ganadora frente al cliché bienintencionado de una no ganadora.
   - Explica si la idea resolvió una tensión del negocio o si fue solo cosmética.
3. EVIDENCIA CONCRETA: Cita obligatoriamente al menos 2 piezas ganadoras y 2 piezas no ganadoras de la lista (con marcas y nombres exactos) para contrastarlas cara a cara.
4. Cierra siempre con una pregunta estratégica abierta para seguir explorando el reto.
`;

    // Llamada con soporte oficial de razonamiento de OpenRouter
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://vercel.com",
        "X-Title": "Festival AI"
      },
      body: JSON.stringify({
        model: "minimax/minimax-m3:free",
        messages: [
          { role: "system", content: promptSistema },
          { role: "user", content: mensaje }
        ],
        reasoning: { enabled: true },
        temperature: 0.4,
        max_tokens: 2048
      })
    });

    const data = await response.json();

    if (!response.ok) {
      const err = data.error?.message || response.statusText;
      return res.status(500).json({ error: `Error de OpenRouter: ${err}` });
    }

    const respuestaTexto = data.choices?.[0]?.message?.content || 'No se obtuvo respuesta del modelo.';
    return res.status(200).json({ respuesta: respuestaTexto });

  } catch (error) {
    console.error('Error general:', error);
    return res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
}
