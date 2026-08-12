jest.mock('../config/env', () => ({
  env: {
    JWT_SECRET: 'test-secret',
    PUBLIC_API_URL: 'https://api.example.com',
    APP_URL: 'https://api.example.com',
    API_PREFIX: '/api',
    API_VERSION: 'v1',
  },
}));

import twilio from 'twilio';
import {
  clipScriptText,
  renderAudioClipPlayback,
  resolveAudioClipSourceType,
} from './phoneSystemAudioClips';

describe('phoneSystemAudioClips', () => {
  const clips = [
    {
      id: 'ac-1',
      name: 'Greeting',
      sourceType: 'message' as const,
      scriptText: 'Hello there',
    },
    {
      id: 'ac-2',
      name: 'Custom upload',
      sourceType: 'upload' as const,
      scriptText: '',
      r2Key: 'agencies/sub-1/clips/ac-2.mp3',
    },
  ];

  it('defaults legacy clips without sourceType to message', () => {
    expect(resolveAudioClipSourceType({ name: 'Legacy', scriptText: 'Hi' })).toBe('message');
    expect(resolveAudioClipSourceType({ name: 'Legacy', scriptText: '', r2Key: 'k' })).toBe('upload');
  });

  it('returns script text for message clips', () => {
    expect(clipScriptText(clips, 'Greeting', 'fallback')).toBe('Hello there');
  });

  it('renders Say for message clips', () => {
    const vr = new twilio.twiml.VoiceResponse();
    renderAudioClipPlayback(vr, clips, 'Greeting', 'sub-1', 'fallback');
    const twiml = vr.toString();
    expect(twiml).toContain('<Say>Hello there</Say>');
    expect(twiml).not.toContain('<Play>');
  });

  it('renders Play for upload clips', () => {
    const vr = new twilio.twiml.VoiceResponse();
    renderAudioClipPlayback(vr, clips, 'Custom upload', 'sub-1', 'fallback');
    const twiml = vr.toString();
    expect(twiml).toContain('<Play>');
    expect(twiml).toContain('/phone-system/audio-clips/ac-2/stream?t=');
    expect(twiml).not.toContain('<Say>');
  });
});
