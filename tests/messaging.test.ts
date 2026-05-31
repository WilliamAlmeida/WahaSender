import { describe, it, expect } from 'vitest';
import { applyPlaceholders, resolveSpintax, toWhatsappChatId } from '../server/lib/messaging';

describe('applyPlaceholders', () => {
  it('replaces {{name}}, {{phone}}, {{id}} placeholders', () => {
    const out = applyPlaceholders('Olá {{name}}, seu telefone {{phone}} id={{id}}', {
      name: 'Ana',
      phone: '5511999990000',
      id: 'abc123',
    });
    expect(out).toBe('Olá Ana, seu telefone 5511999990000 id=abc123');
  });

  it('handles empty values without throwing', () => {
    expect(applyPlaceholders('{{name}}', { name: '', phone: '', id: '' })).toBe('');
  });
});

describe('resolveSpintax', () => {
  it('picks one option from {a|b}', () => {
    let counter = 0;
    const rng = () => (counter++ % 2) / 2; // alternates 0 then 0.5
    const a = resolveSpintax('{Olá|Oi}', rng);
    const b = resolveSpintax('{Olá|Oi}', rng);
    expect(['Olá', 'Oi']).toContain(a);
    expect(['Olá', 'Oi']).toContain(b);
  });

  it('resolves nested spintax', () => {
    const out = resolveSpintax('{Hello|Hi} {there|world}', () => 0);
    expect(out).toMatch(/^(Hello|Hi) (there|world)$/);
  });

  it('returns input unchanged when no spintax present', () => {
    expect(resolveSpintax('plain text', () => 0)).toBe('plain text');
  });
});

describe('toWhatsappChatId', () => {
  it('strips non-digits and appends @c.us', () => {
    expect(toWhatsappChatId('+55 (11) 99999-0000')).toBe('5511999990000@c.us');
  });

  it('passes already-clean numbers through', () => {
    expect(toWhatsappChatId('5511999990000')).toBe('5511999990000@c.us');
  });
});
