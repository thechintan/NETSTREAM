import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { FfmpegProcessManager, buildHlsFfmpegArgs } from './ffmpeg-manager.js';
import { PortAllocator } from './port-allocator.js';
import { resolveSafeHlsPath } from './routes.js';
import { buildSdp } from './sdp.js';

class MockChildProcess extends EventEmitter {
  public stderr = new EventEmitter();
  public stdout = new EventEmitter();
  public killed = false;
  public killSignals: Array<string | number | undefined> = [];

  public kill(signal?: string | number): boolean {
    this.killed = true;
    this.killSignals.push(signal);
    this.emit('exit', null, signal ?? 'SIGTERM');
    return true;
  }
}

describe('HLS recording foundation (Task 22)', () => {
  it('writes a valid RFC 4566 SDP with video and audio codecs, fmtp, and RTCP ports', () => {
    const sdp = buildSdp([
      {
        kind: 'video',
        rtpPort: 50000,
        rtcpPort: 50001,
        codec: {
          mimeType: 'video/H264',
          payloadType: 102,
          clockRate: 90000,
          parameters: {
            'packetization-mode': 1,
            'profile-level-id': '42e01f',
          },
        },
      },
      {
        kind: 'audio',
        rtpPort: 50002,
        rtcpPort: 50003,
        codec: {
          mimeType: 'audio/opus',
          payloadType: 111,
          clockRate: 48000,
          channels: 2,
          parameters: {
            minptime: 10,
            useinbandfec: 1,
          },
        },
      },
    ]);

    expect(sdp).toContain('v=0\r\n');
    expect(sdp).toContain('c=IN IP4 127.0.0.1\r\n');
    expect(sdp).toContain('m=video 50000 RTP/AVP 102\r\n');
    expect(sdp).toContain('a=rtcp:50001 IN IP4 127.0.0.1\r\n');
    expect(sdp).toContain('a=rtpmap:102 H264/90000\r\n');
    expect(sdp).toContain('a=fmtp:102 packetization-mode=1;profile-level-id=42e01f\r\n');
    expect(sdp).toContain('m=audio 50002 RTP/AVP 111\r\n');
    expect(sdp).toContain('a=rtcp:50003 IN IP4 127.0.0.1\r\n');
    expect(sdp).toContain('a=rtpmap:111 opus/48000/2\r\n');
    expect(sdp).toContain('a=fmtp:111 minptime=10;useinbandfec=1\r\n');
  });

  it('allocates distinct even/odd UDP port pairs, reuses released pairs, and throws when exhausted', () => {
    const alloc = new PortAllocator(50000, 50004); // 3 pairs: 50000/50001, 50002/50003, 50004/50005

    const p1 = alloc.allocatePair();
    const p2 = alloc.allocatePair();
    const p3 = alloc.allocatePair();

    expect(p1).toEqual({ rtpPort: 50000, rtcpPort: 50001 });
    expect(p2).toEqual({ rtpPort: 50002, rtcpPort: 50003 });
    expect(p3).toEqual({ rtpPort: 50004, rtcpPort: 50005 });
    expect(alloc.inUsePairCount()).toBe(3);

    expect(() => alloc.allocatePair()).toThrow(/No available UDP port pairs/);

    alloc.releasePair(p2.rtpPort);
    expect(alloc.inUsePairCount()).toBe(2);

    const p4 = alloc.allocatePair();
    expect(p4).toEqual({ rtpPort: 50002, rtcpPort: 50003 });
  });

  it('restarts FFmpeg up to 3 times on unexpected exit, logs stderr at debug, and stops cleanly on demand', () => {
    const spawned: MockChildProcess[] = [];
    const spawnFn = vi.fn(() => {
      const child = new MockChildProcess();
      spawned.push(child);
      return child as unknown as ChildProcess;
    });
    const debugLogs: string[] = [];
    const logger = {
      debug: vi.fn((msg: string) => debugLogs.push(msg)),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const manager = new FfmpegProcessManager({
      spawnFn,
      maxRestarts: 3,
      logger,
      killGraceMs: 50,
    });
    const onRespawn = vi.fn();

    manager.start({
      channelId: 'chan-1',
      sdpPath: '/tmp/chan-1/stream.sdp',
      outputDir: '/tmp/chan-1',
      hasVideo: true,
      hasAudio: true,
      onRespawn,
    });

    expect(spawnFn).toHaveBeenCalledTimes(1);
    expect(manager.isRunning('chan-1')).toBe(true);

    // Verify stderr is captured at debug level
    spawned[0].stderr.emit('data', Buffer.from('frame=12 fps=30'));
    expect(debugLogs.some((l) => l.includes('frame=12 fps=30'))).toBe(true);

    // Crash 3 times -> restarts 1, 2, 3
    spawned[0].emit('exit', 1, null);
    expect(spawnFn).toHaveBeenCalledTimes(2);
    expect(manager.getRestartCount('chan-1')).toBe(1);

    spawned[1].emit('exit', 1, null);
    expect(spawnFn).toHaveBeenCalledTimes(3);
    expect(manager.getRestartCount('chan-1')).toBe(2);

    spawned[2].emit('exit', 1, null);
    expect(spawnFn).toHaveBeenCalledTimes(4);
    expect(manager.getRestartCount('chan-1')).toBe(3);
    expect(onRespawn).toHaveBeenCalledTimes(3);

    // 4th crash exceeds maxRestarts (3) -> does not respawn
    spawned[3].emit('exit', 1, null);
    expect(spawnFn).toHaveBeenCalledTimes(4);
    expect(manager.isRunning('chan-1')).toBe(false);

    // Clean stop and stopAll do NOT trigger restart
    manager.start({
      channelId: 'chan-2',
      sdpPath: '/tmp/chan-2/stream.sdp',
      outputDir: '/tmp/chan-2',
      hasVideo: true,
      hasAudio: false,
    });
    expect(spawnFn).toHaveBeenCalledTimes(5);
    manager.stopAll();
    expect(spawnFn).toHaveBeenCalledTimes(5);
    expect(manager.activeCount()).toBe(0);
    expect(spawned[4].killSignals).toContain('SIGTERM');
  });

  it('builds FFmpeg HLS args with libx264 veryfast zerolatency, 2s segments, list of 6, delete_segments, and prevents path traversal', () => {
    const args = buildHlsFfmpegArgs({
      sdpPath: '/tmp/hls/stream.sdp',
      outputDir: '/tmp/hls',
      hasVideo: true,
      hasAudio: true,
    });

    expect(args).toContain('libx264');
    expect(args).toContain('veryfast');
    expect(args).toContain('zerolatency');
    expect(args).toContain('aac');
    expect(args).toContain('-hls_time');
    expect(args[args.indexOf('-hls_time') + 1]).toBe('2');
    expect(args).toContain('-hls_list_size');
    expect(args[args.indexOf('-hls_list_size') + 1]).toBe('6');
    expect(args.some((a) => a.includes('delete_segments'))).toBe(true);

    const validUuid = '11111111-2222-3333-4444-555555555555';
    expect(resolveSafeHlsPath('./media/hls', validUuid, 'index.m3u8')).not.toBeNull();
    expect(resolveSafeHlsPath('./media/hls', validUuid, 'seg_00001.ts')).not.toBeNull();

    // Path traversal & non-whitelisted files rejected
    expect(resolveSafeHlsPath('./media/hls', '../etc', 'passwd')).toBeNull();
    expect(resolveSafeHlsPath('./media/hls', validUuid, '../secret.txt')).toBeNull();
    expect(resolveSafeHlsPath('./media/hls', validUuid, 'stream.sdp')).toBeNull();
    expect(resolveSafeHlsPath('./media/hls', 'not-a-uuid', 'index.m3u8')).toBeNull();
  });
});
