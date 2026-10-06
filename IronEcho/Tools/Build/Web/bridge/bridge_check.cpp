// Native twin of the browser core: runs an input script through the same bridge and prints state hashes.
// Used by Tools/Build/Web/build_web.py to prove the WebAssembly (and wasm2js) core is bit-identical to native.
// Input (stdin): doubles, header [mode, level, seed, rounds, roundSeconds, frames], then per frame
// [dt, status, lean, block, punchMask, moveForward, moveLateral, kickMask]. Output: one FNV-1a hash per 60 frames and a final line "final <hash>".
#include <cstdint>
#include <cstdio>
#include <vector>

extern "C" const double* ie_state();
extern "C" int32_t ie_state_size();
extern "C" const double* ie_combat_events();
extern "C" int32_t ie_combat_event_count();
extern "C" int32_t ie_combat_event_size();
extern "C" void ie_clear_events();
extern "C" double* ie_versus_input();
extern "C" int32_t ie_versus_step(int32_t);
extern "C" void ie_init(int32_t, int32_t, double, int32_t, double);
extern "C" int32_t ie_frame(double, int32_t, double, double, double, double, int32_t, double, double, double, int32_t);

namespace
{
	uint64_t Mix(uint64_t Hash, const double* Data, int32_t Count)
	{
		const unsigned char* Bytes = reinterpret_cast<const unsigned char*>(Data);
		for (int32_t Index = 0; Index < Count * 8; ++Index)
		{
			Hash ^= Bytes[Index];
			Hash *= 1099511628211ULL;
		}
		return Hash;
	}
}

int main()
{
	std::vector<double> In;
	double Value = 0.0;
	while (std::fread(&Value, sizeof(double), 1, stdin) == 1)
	{
		In.push_back(Value);
	}
	if (In.size() < 6)
	{
		return 1;
	}
	ie_init(static_cast<int32_t>(In[0]), static_cast<int32_t>(In[1]), In[2], static_cast<int32_t>(In[3]), In[4]);
	const int32_t Frames = static_cast<int32_t>(In[5]);
	uint64_t Hash = 14695981039346656037ULL; // FNV-1a 64 offset basis (0xcbf29ce484222325)
	for (int32_t F = 0; F < Frames; ++F)
	{
		const double* R = In.data() + 6 + F * 8;
		ie_frame(R[0], static_cast<int32_t>(R[1]), 1.0, R[2], 0.0, R[3], static_cast<int32_t>(R[4]), 1.0, R[5], R[6], static_cast<int32_t>(R[7]));
		Hash = Mix(Hash, ie_state(), ie_state_size());
		Hash = Mix(Hash, ie_combat_events(), ie_combat_event_count() * ie_combat_event_size());
		ie_clear_events();
		if ((F + 1) % 60 == 0)
		{
			std::printf("%d %016llx\n", F + 1, static_cast<unsigned long long>(Hash));
		}
	}
	// Versus lockstep: the same bridge in mode 2 driven by a scripted pair of players (header word 7 > 0 = frames of versus)
	ie_init(2, 1, In[2], 2, 20.0);
	double* V = ie_versus_input();
	uint64_t VHash = 14695981039346656037ULL;
	uint32_t Rng = 12345u;
	auto Next = [&Rng]() { Rng = Rng * 1664525u + 1013904223u; return static_cast<double>(Rng >> 8) / 16777216.0; };
	for (int32_t F = 0; F < 4000; ++F)
	{
		for (int32_t Slot = 0; Slot < 2; ++Slot)
		{
			double* P = V + Slot * 10;
			P[0] = 7.0; P[1] = 1.0; P[2] = Next() < 0.05 ? (Next() < 0.5 ? -1.0 : 1.0) : 0.0; P[3] = 0.0;
			P[4] = Next() < 0.1 ? 1.0 : 0.0;
			P[5] = Next() < 0.03 ? static_cast<double>(1 << static_cast<int32_t>(Next() * 4.0)) : 0.0;
			P[6] = Next() < 0.01 ? static_cast<double>(1 << static_cast<int32_t>(Next() * 4.0)) : 0.0;
			P[7] = Next() < 0.4 ? (Next() < 0.5 ? 1.0 : -1.0) : 0.0;
			P[8] = Next() < 0.2 ? (Next() < 0.5 ? 1.0 : -1.0) : 0.0;
			P[9] = 0.0;
		}
		ie_versus_step(2);
		VHash = Mix(VHash, ie_state(), ie_state_size());
		VHash = Mix(VHash, ie_combat_events(), ie_combat_event_count() * ie_combat_event_size());
		ie_clear_events();
	}
	std::printf("versus %016llx\n", static_cast<unsigned long long>(VHash));
	std::printf("final %016llx\n", static_cast<unsigned long long>(Hash));
	return 0;
}
