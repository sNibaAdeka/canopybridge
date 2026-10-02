// Minimal dependency-free test harness (no exceptions: failures are recorded, the test continues).
#pragma once

#include <cmath>
#include <cstdio>
#include <functional>
#include <string>
#include <vector>

namespace IeTest
{
	struct Case
	{
		const char* Name;
		std::function<void()> Body;
	};

	inline std::vector<Case>& Registry()
	{
		static std::vector<Case> Cases;
		return Cases;
	}

	inline int& FailureCount()
	{
		static int Count = 0;
		return Count;
	}

	inline const char*& CurrentCase()
	{
		static const char* Name = "";
		return Name;
	}

	struct Registrar
	{
		Registrar(const char* Name, std::function<void()> Body) { Registry().push_back({Name, std::move(Body)}); }
	};

	inline void Fail(const char* File, int Line, const std::string& Message)
	{
		++FailureCount();
		std::printf("  FAIL [%s] %s:%d: %s\n", CurrentCase(), File, Line, Message.c_str());
	}
}

#define IE_CONCAT_INNER(A, B) A##B
#define IE_CONCAT(A, B) IE_CONCAT_INNER(A, B)

#define IE_TEST(Name)                                                                  \
	static void IE_CONCAT(IeTestBody_, Name)();                                        \
	static IeTest::Registrar IE_CONCAT(IeTestReg_, Name)(#Name, &IE_CONCAT(IeTestBody_, Name)); \
	static void IE_CONCAT(IeTestBody_, Name)()

#define IE_EXPECT(Cond)                                                                \
	do                                                                                 \
	{                                                                                  \
		if (!(Cond))                                                                   \
		{                                                                              \
			IeTest::Fail(__FILE__, __LINE__, "expected: " #Cond);                      \
		}                                                                              \
	} while (0)

#define IE_EXPECT_EQ(A, B)                                                             \
	do                                                                                 \
	{                                                                                  \
		const auto IeA = (A);                                                          \
		const auto IeB = (B);                                                          \
		if (!(IeA == IeB))                                                             \
		{                                                                              \
			IeTest::Fail(__FILE__, __LINE__, std::string("expected equal: " #A " == " #B " (") \
				+ std::to_string(static_cast<long long>(IeA)) + " vs " + std::to_string(static_cast<long long>(IeB)) + ")"); \
		}                                                                              \
	} while (0)

#define IE_EXPECT_NEAR(A, B, Tol)                                                      \
	do                                                                                 \
	{                                                                                  \
		const double IeA = static_cast<double>(A);                                     \
		const double IeB = static_cast<double>(B);                                     \
		if (!(std::fabs(IeA - IeB) <= (Tol)))                                          \
		{                                                                              \
			IeTest::Fail(__FILE__, __LINE__, std::string("expected near: " #A " ~ " #B " (") \
				+ std::to_string(IeA) + " vs " + std::to_string(IeB) + ")");           \
		}                                                                              \
	} while (0)
