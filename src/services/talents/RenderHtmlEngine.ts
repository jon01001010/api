import {TalentEngine, TalentResult, ToolDefinition} from './types';

/**
 * Engine for the `render_html` talent.
 *
 * Arguments:
 *   - `html` (string, required): the HTML document (or fragment) to render.
 *   - `title` (string, optional): a short label shown above the preview.
 *
 * Security model: this engine is a pure pass-through — sanitization is the
 * WebView wrapper's job. See HtmlPreviewBubble for the actual envelope:
 * strict CSP (default-src 'none', no network/external fetch), but JavaScript
 * IS enabled with 'unsafe-inline' + 'unsafe-eval' for interactive HTML/games.
 * Navigation is pinned to about:blank; no native bridge surface.
 */
export class RenderHtmlEngine implements TalentEngine {
  readonly name = 'render_html';
  readonly recommendedContextTokens = 4096;

  async execute(args: Record<string, any>): Promise<TalentResult> {
    const html = typeof args.html === 'string' ? args.html : '';
    const title = typeof args.title === 'string' ? args.title : undefined;

    if (!html) {
      return {
        type: 'error',
        summary: 'render_html: missing or empty "html" argument',
        errorMessage:
          'html argument is required and must be a non-empty string',
      };
    }

    return {
      type: 'html',
      html,
      title,
      summary: `[render_html SUCCESS] The html has been rendered into a preview above, and the user can see and toggle to see the code. 
Reply with at most one short sentence what you build`,
    };
  }

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: 'render_html',
        description:
          'Show a live web page (HTML, CSS, JavaScript) inside the chat. Use it when the user asks for a page, ' +
          'app, game, chart, clock or widget. How: write the whole page in `html` with all CSS and JavaScript ' +
          'inline (no external files), and a short `title`. JavaScript runs, so timers and buttons work.',
        parameters: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Short label shown above the preview.',
            },
            html: {
              type: 'string',
              description:
                'The complete page, e.g. <!doctype html><html><head><style>…</style></head><body>…<script>…</script></body></html>.',
            },
          },
          required: ['html'],
        },
      },
    };
  }
}
