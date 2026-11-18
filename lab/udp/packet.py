"""Binary UDP measurement packet format using struct in network byte order (!).

Header layout (16 bytes):
  magic        : 2s (b"NS")
  version      : B  (1)
  flags        : B  (bit0=ACK_REQUESTED, bit1=ACK_REPLY, bit2=END_CONTROL)
  sequence     : I  (uint32, 4 bytes)
  send_time_ns : Q  (uint64, 8 bytes)
Followed by configurable payload bytes padded to `payload_size`.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass

MAGIC = b"NS"
VERSION = 1

FLAG_ACK_REQUESTED = 0x01
FLAG_ACK_REPLY = 0x02
FLAG_END = 0x04

HEADER_FORMAT = "!2sBBIQ"
HEADER_SIZE = struct.calcsize(HEADER_FORMAT)  # 16 bytes


@dataclass(frozen=True)
class UdpPacket:
    magic: bytes
    version: int
    flags: int
    sequence: int
    send_time_ns: int
    payload: bytes

    @property
    def ack_requested(self) -> bool:
        return bool(self.flags & FLAG_ACK_REQUESTED)

    @property
    def is_ack(self) -> bool:
        return bool(self.flags & FLAG_ACK_REPLY)

    @property
    def is_end(self) -> bool:
        return bool(self.flags & FLAG_END)

    @property
    def total_bytes(self) -> int:
        return HEADER_SIZE + len(self.payload)


def encode_packet(
    sequence: int,
    send_time_ns: int,
    payload_size: int = 0,
    flags: int = 0,
    payload: bytes | None = None,
) -> bytes:
    """Pack header and pad/truncate payload to `payload_size` bytes."""
    if sequence < 0 or sequence > 0xFFFFFFFF:
        raise ValueError("sequence must fit in uint32")
    if send_time_ns < 0 or send_time_ns > 0xFFFFFFFFFFFFFFFF:
        raise ValueError("send_time_ns must fit in uint64")
    if payload_size < 0:
        raise ValueError("payload_size must be non-negative")

    header = struct.pack(HEADER_FORMAT, MAGIC, VERSION, flags & 0xFF, sequence, send_time_ns)
    if payload is None:
        body = b"\x00" * payload_size
    elif len(payload) < payload_size:
        body = payload + (b"\x00" * (payload_size - len(payload)))
    else:
        body = payload[:payload_size] if payload_size > 0 else payload
    return header + body


def decode_packet(data: bytes) -> UdpPacket:
    """Unpack and validate a raw UDP datagram."""
    if len(data) < HEADER_SIZE:
        raise ValueError(f"Packet too short: {len(data)} bytes (need >= {HEADER_SIZE})")

    magic, version, flags, sequence, send_time_ns = struct.unpack(
        HEADER_FORMAT, data[:HEADER_SIZE]
    )
    if magic != MAGIC:
        raise ValueError(f"Invalid magic bytes: {magic!r}")
    if version != VERSION:
        raise ValueError(f"Unsupported protocol version: {version}")

    return UdpPacket(
        magic=magic,
        version=version,
        flags=flags,
        sequence=sequence,
        send_time_ns=send_time_ns,
        payload=data[HEADER_SIZE:],
    )


def encode_ack(sequence: int, echoed_send_time_ns: int) -> bytes:
    """Create an ACK packet echoing sequence and original send_time_ns."""
    return encode_packet(
        sequence=sequence,
        send_time_ns=echoed_send_time_ns,
        payload_size=0,
        flags=FLAG_ACK_REPLY,
    )


def encode_end(total_sent: int, send_time_ns: int) -> bytes:
    """Create an END control packet signalling completion of a sender run."""
    return encode_packet(
        sequence=total_sent,
        send_time_ns=send_time_ns,
        payload_size=0,
        flags=FLAG_END,
    )
