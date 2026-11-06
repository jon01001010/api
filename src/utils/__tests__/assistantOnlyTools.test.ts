import {assistantOnlyTools} from '../globalToolSettings';

describe('assistantOnlyTools: Toolbox switches always win', () => {
  it('keeps only the harmless built-ins an assistant may add by itself', () => {
    expect(
      assistantOnlyTools([
        {name: 'calculate'},
        {name: 'datetime'},
        {name: 'render_html'},
      ]),
    ).toEqual(['calculate', 'datetime', 'render_html']);
  });

  it('drops phone actions, web, files, memory, tool making and custom tools', () => {
    expect(
      assistantOnlyTools([
        {name: 'set_alarm'},
        {name: 'compose_message'},
        {name: 'web_search'},
        {name: 'read_url'},
        {name: 'file_write'},
        {name: 'memory_replace'},
        {name: 'tool_save'},
        {name: 'morning'},
      ]),
    ).toEqual([]);
  });
});
