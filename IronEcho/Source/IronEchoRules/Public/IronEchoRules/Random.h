// PCG32 (O'Neill, pcg-random.org): small, fast, bit-identical on every platform/compiler.
// std:: distributions are implementation-defined, so the bot never uses them.
#pragma once

#include <cstdint>

namespace IronEchoCore
{
	class Pcg32
	{
	public:
		explicit Pcg32(uint64_t Seed = 0x853c49e6748fea9bULL, uint64_t Stream = 0xda3e39cb94b95bdbULL)
		{
			Reseed(Seed, Stream);
		}

		void Reseed(uint64_t Seed, uint64_t Stream = 0xda3e39cb94b95bdbULL)
		{
			State = 0u;
			Increment = (Stream << 1u) | 1u;
			NextU32();
			State += Seed;
			NextU32();
		}

		uint32_t NextU32()
		{
			const uint64_t Old = State;
			State = Old * 6364136223846793005ULL + Increment;
			const uint32_t XorShifted = static_cast<uint32_t>(((Old >> 18u) ^ Old) >> 27u);
			const uint32_t Rot = static_cast<uint32_t>(Old >> 59u);
			return (XorShifted >> Rot) | (XorShifted << ((0u - Rot) & 31u));
		}

		// Uniform in [0, 1).
		float NextFloat01()
		{
			return static_cast<float>(NextU32() >> 8) * (1.0f / 16777216.0f);
		}

		bool Chance(float Probability)
		{
			return NextFloat01() < Probability;
		}

		// Uniform integer in [Lo, Hi] (inclusive). Lo <= Hi required.
		int32_t RangeInclusive(int32_t Lo, int32_t Hi)
		{
			if (Hi <= Lo)
			{
				return Lo;
			}
			const uint32_t Span = static_cast<uint32_t>(Hi - Lo) + 1u;
			return Lo + static_cast<int32_t>(NextU32() % Span);
		}

	private:
		uint64_t State = 0;
		uint64_t Increment = 0;
	};
}
