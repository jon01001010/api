import {resolveStartupExperience} from '../startupExperiencePolicy';
it('starts without listening and opens model picker when unloaded', () => {
 const s=resolveStartupExperience({wakeListeningEnabled:true},false);
 expect(s.listening).toBe(false);expect(s.screen).toBe('model-picker');expect(s.enabledTools).toEqual([]);
});
it('uses model name instead of assistant identity',()=>{
 const s=resolveStartupExperience({modelName:'Qwen3.5-2B',globalSystemPrompt:'Hello'},true);
 expect(s.title).toBe('Qwen3.5-2B');expect(s.systemPrompt).toBe('Hello');
});
