#include "TestFramework.h"

#include <cstring>

int main(int ArgCount, char** Args)
{
	const char* Filter = ArgCount > 1 ? Args[1] : nullptr;
	int Ran = 0;
	for (const IeTest::Case& TestCase : IeTest::Registry())
	{
		if (Filter != nullptr && std::strstr(TestCase.Name, Filter) == nullptr)
		{
			continue;
		}
		IeTest::CurrentCase() = TestCase.Name;
		const int Before = IeTest::FailureCount();
		TestCase.Body();
		std::printf("%s %s\n", IeTest::FailureCount() == Before ? "[ OK ]" : "[FAIL]", TestCase.Name);
		++Ran;
	}
	std::printf("\n%d test cases, %d failed expectations\n", Ran, IeTest::FailureCount());
	return IeTest::FailureCount() == 0 && Ran > 0 ? 0 : 1;
}
