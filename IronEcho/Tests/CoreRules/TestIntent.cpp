#include "TestFramework.h"

#include "IronEchoRules/InputFrame.h"

using namespace IronEchoCore;

namespace
{
	InputFrame Live(float Lean = 0.0f, float Block = 0.0f)
	{
		InputFrame Frame;
		Frame.Status = TrackingStatus::Live;
		Frame.LeanLateral = Lean;
		Frame.BlockAmount = Block;
		return Frame;
	}
}

IE_TEST(Intent_DodgeHysteresis)
{
	IntentMapper Mapper;
	IE_EXPECT(Mapper.Map(Live(0.50f)).Dodge == DodgeDir::None);
	IE_EXPECT(Mapper.Map(Live(0.56f)).Dodge == DodgeDir::Right);
	IE_EXPECT(Mapper.Map(Live(0.45f)).Dodge == DodgeDir::Right); // inside the hysteresis band
	IE_EXPECT(Mapper.Map(Live(0.39f)).Dodge == DodgeDir::None);
	IE_EXPECT(Mapper.Map(Live(-0.60f)).Dodge == DodgeDir::Left);
	// Direct flip across zero goes through the exit band.
	IE_EXPECT(Mapper.Map(Live(0.70f)).Dodge == DodgeDir::Right);
}

IE_TEST(Intent_BlockHysteresisAndPunchCancels)
{
	IntentMapper Mapper;
	IE_EXPECT(!Mapper.Map(Live(0.0f, 0.55f)).bBlock);
	IE_EXPECT(Mapper.Map(Live(0.0f, 0.65f)).bBlock);
	IE_EXPECT(Mapper.Map(Live(0.0f, 0.50f)).bBlock);
	InputFrame WithPunch = Live(0.0f, 0.9f);
	PunchIntent Punch;
	Punch.PunchHand = Hand::Right;
	Punch.Confidence = 0.9f;
	WithPunch.AddPunch(Punch);
	const FighterIntent Intent = Mapper.Map(WithPunch);
	IE_EXPECT(!Intent.bBlock);
	IE_EXPECT_EQ(Intent.PunchCount, 1);
	IE_EXPECT(!Mapper.Map(Live(0.0f, 0.50f)).bBlock); // must re-enter above BlockEnter
}

IE_TEST(Intent_NotLiveIsNeutral)
{
	IntentMapper Mapper;
	Mapper.Map(Live(0.9f, 0.9f));
	InputFrame Lost = Live(0.9f, 0.9f);
	Lost.Status = TrackingStatus::NoPerson;
	PunchIntent Punch;
	Punch.Confidence = 1.0f;
	Lost.AddPunch(Punch);
	const FighterIntent Intent = Mapper.Map(Lost);
	IE_EXPECT(!Intent.bBlock);
	IE_EXPECT(Intent.Dodge == DodgeDir::None);
	IE_EXPECT_EQ(Intent.PunchCount, 0);
}

IE_TEST(Intent_LowConfidencePunchFiltered)
{
	IntentMapper Mapper;
	InputFrame Frame = Live();
	PunchIntent Weak;
	Weak.Confidence = 0.3f;
	Frame.AddPunch(Weak);
	IE_EXPECT_EQ(Mapper.Map(Frame).PunchCount, 0);
}
