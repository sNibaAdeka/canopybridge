#include "IronEchoRules/Crc32.h"

#include <array>

namespace IronEchoCore
{
	namespace
	{
		constexpr std::array<uint32_t, 256> MakeCrcTable()
		{
			std::array<uint32_t, 256> Table{};
			for (uint32_t Index = 0; Index < 256; ++Index)
			{
				uint32_t Value = Index;
				for (int Bit = 0; Bit < 8; ++Bit)
				{
					Value = (Value & 1u) ? (0xEDB88320u ^ (Value >> 1)) : (Value >> 1);
				}
				Table[Index] = Value;
			}
			return Table;
		}

		constexpr std::array<uint32_t, 256> GCrcTable = MakeCrcTable();
	}

	uint32_t Crc32(const uint8_t* Data, size_t Size, uint32_t Seed)
	{
		uint32_t Crc = ~Seed;
		for (size_t Index = 0; Index < Size; ++Index)
		{
			Crc = GCrcTable[(Crc ^ Data[Index]) & 0xFFu] ^ (Crc >> 8);
		}
		return ~Crc;
	}
}
