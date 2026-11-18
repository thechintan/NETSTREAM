export interface SdpCodecInfo {
  mimeType: string;
  payloadType: number;
  clockRate: number;
  channels?: number;
  parameters?: Record<string, string | number | boolean>;
}

export interface SdpMediaStreamInput {
  kind: 'video' | 'audio';
  rtpPort: number;
  rtcpPort: number;
  codec: SdpCodecInfo;
}

function extractCodecName(mimeType: string): string {
  const parts = mimeType.split('/');
  return (parts[1] ?? mimeType).trim();
}

function formatFmtpParameters(parameters?: Record<string, string | number | boolean>): string | null {
  if (!parameters) return null;
  const entries = Object.entries(parameters).filter(
    ([, v]) => v !== undefined && v !== null && v !== ''
  );
  if (entries.length === 0) return null;
  return entries.map(([k, v]) => `${k}=${String(v)}`).join(';');
}

/**
 * Generates an RFC 4566 SDP description for one or two local RTP/RTCP streams
 * emitted by mediasoup PlainTransports on 127.0.0.1 for FFmpeg ingestion.
 */
export function buildSdp(streams: SdpMediaStreamInput[], sessionName = 'NetStream Live HLS'): string {
  if (streams.length === 0) {
    throw new Error('Cannot generate SDP without at least one media stream');
  }

  const lines: string[] = [
    'v=0',
    'o=- 0 0 IN IP4 127.0.0.1',
    `s=${sessionName}`,
    'c=IN IP4 127.0.0.1',
    't=0 0',
  ];

  for (const stream of streams) {
    const codecName = extractCodecName(stream.codec.mimeType);
    const pt = stream.codec.payloadType;
    const rtpmapChannels =
      stream.kind === 'audio' && stream.codec.channels && stream.codec.channels > 1
        ? `/${stream.codec.channels}`
        : '';

    lines.push(`m=${stream.kind} ${stream.rtpPort} RTP/AVP ${pt}`);
    lines.push('c=IN IP4 127.0.0.1');
    lines.push(`a=rtcp:${stream.rtcpPort} IN IP4 127.0.0.1`);
    lines.push(`a=rtpmap:${pt} ${codecName}/${stream.codec.clockRate}${rtpmapChannels}`);

    const fmtp = formatFmtpParameters(stream.codec.parameters);
    if (fmtp) {
      lines.push(`a=fmtp:${pt} ${fmtp}`);
    }

    lines.push('a=recvonly');
  }

  return `${lines.join('\r\n')}\r\n`;
}
