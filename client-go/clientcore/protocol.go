package clientcore

import (
	"encoding/binary"
	"errors"
)

const (
	FrameData            byte = 0x01
	FrameOpenChannel     byte = 0x02
	FrameChannelOpened   byte = 0x03
	FrameCloseChannel    byte = 0x04
	FrameChannelError    byte = 0x05
	FrameStateUpdate     byte = 0x10
	FrameTransferSync    byte = 0x11
	FrameTransferRequest byte = 0x12
	FrameSyncRequest     byte = 0x22
	FrameSyncResponse    byte = 0x23
	frameHeaderSize           = 7
)

type bridgeFrame struct {
	typ       byte
	channelID uint16
	payload   []byte
}

func encodeFrame(typ byte, channelID uint16, payload []byte) []byte {
	buf := make([]byte, frameHeaderSize+len(payload))
	buf[0] = typ
	binary.BigEndian.PutUint16(buf[1:3], channelID)
	binary.BigEndian.PutUint32(buf[3:7], uint32(len(payload)))
	copy(buf[7:], payload)
	return buf
}

func decodeFrame(data []byte) (bridgeFrame, error) {
	if len(data) < frameHeaderSize {
		return bridgeFrame{}, errors.New("bridge frame is shorter than header")
	}
	n := int(binary.BigEndian.Uint32(data[3:7]))
	if n < 0 || len(data) != frameHeaderSize+n {
		return bridgeFrame{}, errors.New("bridge frame payload length mismatch")
	}
	return bridgeFrame{typ: data[0], channelID: binary.BigEndian.Uint16(data[1:3]), payload: data[7:]}, nil
}
