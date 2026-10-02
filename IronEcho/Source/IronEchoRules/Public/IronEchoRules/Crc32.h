// CRC-32 (IEEE 802.3, reflected polynomial 0xEDB88320). Bit-identical to zlib.crc32 / Python zlib.crc32.
#pragma once

#include <cstddef>
#include <cstdint>

namespace IronEchoCore
{
	uint32_t Crc32(const uint8_t* Data, size_t Size, uint32_t Seed = 0);
}
