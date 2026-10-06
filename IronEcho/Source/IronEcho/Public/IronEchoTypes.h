// Blueprint-facing types of the IRON ECHO gameplay contract (schema 1).
// Normative: Docs/Contracts/ROBOT_VISUAL_CONTRACT.md and Docs/Contracts/INPUT_CONTRACT.md.
// Changing anything here is a contract change: bump IRONECHO_VISUAL_CONTRACT_VERSION and write a handoff.
#pragma once

#include "CoreMinimal.h"

#include "IronEchoTypes.generated.h"

#define IRONECHO_VISUAL_CONTRACT_VERSION 2
#define IRONECHO_VISUAL_CONTRACT_MINOR 1

IRONECHO_API DECLARE_LOG_CATEGORY_EXTERN(LogIronEcho, Log, All);

UENUM(BlueprintType)
enum class EIronEchoHand : uint8
{
	Left,
	Right
};

UENUM(BlueprintType)
enum class EIronEchoFighterRole : uint8
{
	Player,
	Opponent
};

UENUM(BlueprintType)
enum class EIronEchoActionState : uint8
{
	Guard,
	Attack,
	Block,
	HitStun,
	BlockStun,
	KnockedOut,
	KnockedDown
};

UENUM(BlueprintType)
enum class EIronEchoAttackStage : uint8
{
	None,
	Windup,
	Active,
	Recovery
};

UENUM(BlueprintType)
enum class EIronEchoDodge : uint8
{
	None,
	Left,
	Right
};

UENUM(BlueprintType)
enum class EIronEchoTrackingStatus : uint8
{
	Offline,
	Starting,
	NoCamera,
	NoPerson,
	LowConfidence,
	NotCalibrated,
	Calibrating,
	Live
};

UENUM(BlueprintType)
enum class EIronEchoCalibrationStep : uint8
{
	Idle,
	Neutral,
	RaiseRightHand,
	SlipLeft,
	SlipRight,
	Done
};

UENUM(BlueprintType)
enum class EIronEchoCalibrationFailure : uint8
{
	None,
	Timeout,
	LowVisibility,
	Unstable,
	Cancelled
};

UENUM(BlueprintType)
enum class EIronEchoTrackerError : uint8
{
	None,
	CameraOpenFailed,
	ModelLoadFailed,
	CameraReadFailed,
	ProcessNotFound,
	ProcessCrashed,
	SocketBindFailed
};

UENUM(BlueprintType)
enum class EIronEchoInputSource : uint8
{
	Tracker,
	Keyboard
};

UENUM(BlueprintType)
enum class EIronEchoMatchMode : uint8
{
	Bout,
	Training
};

UENUM(BlueprintType)
enum class EIronEchoBotLevel : uint8
{
	Easy,
	Normal,
	Hard
};

UENUM(BlueprintType)
enum class EIronEchoMatchPhase : uint8
{
	WaitingForPlayer,
	Countdown,
	Fighting,
	RoundBreak,
	MatchOver,
	Paused,
	Training,
	Knockdown
};

UENUM(BlueprintType)
enum class EIronEchoPauseReason : uint8
{
	None,
	Manual,
	TrackingLost
};

UENUM(BlueprintType)
enum class EIronEchoResultMethod : uint8
{
	None,
	KnockOut,
	Decision,
	Draw,
	TechnicalKnockOut
};

UENUM(BlueprintType)
enum class EIronEchoDecisionKind : uint8
{
	None,
	Unanimous,
	Split,
	Majority
};

UENUM(BlueprintType)
enum class EIronEchoCombatEventType : uint8
{
	AttackStarted,
	AttackActive,
	AttackRecovery,
	AttackFinished,
	AttackCancelled,
	HitConfirmed,
	Blocked,
	Dodged,
	Whiffed,
	GuardBroken,
	KnockedOut,
	StaminaExhausted,
	BlockStarted,
	BlockEnded,
	DodgeStarted,
	DodgeEnded,
	InputDropped,
	KnockedDown,
	GotUp
};

UENUM(BlueprintType)
enum class EIronEchoMatchEventType : uint8
{
	PhaseChanged,
	RoundStarted,
	RoundEnded,
	MatchEnded,
	Paused,
	Resumed,
	CountdownTick,
	KnockdownCount
};

/** Everything a robot's AnimBP / VFX needs each frame. Units: cm, seconds; body frame X fwd, Y right, Z up. */
USTRUCT(BlueprintType)
struct IRONECHO_API FIronEchoFighterVisualState
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") int32 SchemaVersion = IRONECHO_VISUAL_CONTRACT_VERSION;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") EIronEchoFighterRole Role = EIronEchoFighterRole::Player;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") EIronEchoMatchPhase MatchPhase = EIronEchoMatchPhase::WaitingForPlayer;

	UPROPERTY(BlueprintReadOnly, Category = "IronEcho|Action") EIronEchoActionState ActionState = EIronEchoActionState::Guard;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho|Action") EIronEchoAttackStage AttackStage = EIronEchoAttackStage::None;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho|Action") EIronEchoHand AttackHand = EIronEchoHand::Left;
	/** 0 at the start of the current attack stage, 1 at its end. Drive montages / sequence evaluators with it. */
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho|Action") float AttackStageAlpha = 0.0f;
	/** Duration of the current attack stage in seconds (already includes tired / whiff modifiers). */
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho|Action") float AttackStageDuration = 0.0f;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho|Action") int32 AttackId = 0;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho|Action") bool bAttackTired = false;
	/** Remaining stun time (HitStun / BlockStun), seconds. */
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho|Action") float StunRemaining = 0.0f;

	UPROPERTY(BlueprintReadOnly, Category = "IronEcho|Defense") bool bBlocking = false;
	/** Smoothed 0..1 version of bBlocking for blending. */
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho|Defense") float BlockAlpha = 0.0f;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho|Defense") EIronEchoDodge Dodge = EIronEchoDodge::None;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho|Defense") bool bDodgeEffective = false;

	/** Continuous mirroring of the player's upper body. -1..1, + = robot's own right. */
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho|Pose") float LeanLateral = 0.0f;
	/** -1..1, + = toward the opponent. */
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho|Pose") float LeanForward = 0.0f;
	/** Tracked hand targets in ARM LENGTHS relative to the shoulder centre, body frame. Multiply by the robot's arm length. */
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho|Pose") FVector HandTargetLeft = FVector(0.45, -0.15, 0.25);
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho|Pose") FVector HandTargetRight = FVector(0.45, 0.15, 0.25);
	/** How much the AnimBP should follow the tracked hands (1 in guard/block, 0 during own attack, stun, KO). */
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho|Pose") float HandTrackingAlphaLeft = 1.0f;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho|Pose") float HandTrackingAlphaRight = 1.0f;

	UPROPERTY(BlueprintReadOnly, Category = "IronEcho|Stats") float Health01 = 1.0f;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho|Stats") float Stamina01 = 1.0f;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho|Stats") bool bKnockedOut = false;
	/** Down for the referee count (1.1): play the knockdown / on-the-canvas pose; GotUp event ends it. */
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho|Stats") bool bKnockedDown = false;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho|Stats") int32 KnockdownsSuffered = 0;
	/** Current run of clean hits by this fighter (1.1). */
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho|Stats") int32 ComboCount = 0;

	/** Centre-to-centre distance to the opponent, cm. */
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho|Space") float DistanceToOpponent = 135.0f;
	/** Footwork (contract 2): the robot's own speed toward the opponent (- = backing off) and to its own right
	 *  (circling), cm/s. The actor transform already moves and turns the robot; drive the leg cycle with these. */
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho|Space") float MoveForwardSpeed = 0.0f;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho|Space") float MoveRightSpeed = 0.0f;
	/** Ropes behind / beside the robot (no room to back off): lean back on them, cornered poses. */
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho|Space") bool bOnRopes = false;
	/** The head's real offset off the centre line to the robot's right, cm (what hit detection uses). */
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho|Defense") float HeadSlip = 0.0f;
	/** The current punch goes to the body (contract 2): lower the punch path, bend the knees. */
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho|Action") bool bBodyShot = false;
	/** The current attack is a leg kick (contract 2.1): AttackHand = Left lead leg (front kick), Right rear leg (round kick). */
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho|Action") bool bKick = false;
	/** The current kick goes low (to the legs). */
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho|Action") bool bLowKick = false;
	/** Seconds the legs stay slowed after low kicks (limp). */
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho|Space") float LegSlowSeconds = 0.0f;

	/** World time (seconds) of the last clean hit taken; < 0 if none. */
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho|Reaction") float LastHitTakenTime = -1.0f;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho|Reaction") EIronEchoHand LastHitTakenFromHand = EIronEchoHand::Left;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho|Reaction") int32 HitsTaken = 0;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho|Reaction") float LastBlockTime = -1.0f;
};

USTRUCT(BlueprintType)
struct IRONECHO_API FIronEchoFighterHud
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") float Health = 100.0f;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") float MaxHealth = 100.0f;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") float Stamina = 100.0f;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") float MaxStamina = 100.0f;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") EIronEchoActionState ActionState = EIronEchoActionState::Guard;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") int32 PunchesThrown = 0;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") int32 PunchesLanded = 0;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") int32 DodgesMade = 0;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") int32 BlocksMade = 0;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") int32 CounterHits = 0;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") int32 ComboCount = 0;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") int32 MaxCombo = 0;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") int32 KnockdownsSuffered = 0;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") bool bKnockedDown = false;
};

USTRUCT(BlueprintType)
struct IRONECHO_API FIronEchoTrackingHud
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") EIronEchoInputSource InputSource = EIronEchoInputSource::Tracker;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") EIronEchoTrackingStatus Status = EIronEchoTrackingStatus::Offline;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") EIronEchoCalibrationStep CalibrationStep = EIronEchoCalibrationStep::Idle;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") int32 CalibrationProgress = 0;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") EIronEchoCalibrationFailure CalibrationFailure = EIronEchoCalibrationFailure::None;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") bool bMirrorApplied = false;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") EIronEchoTrackerError LastError = EIronEchoTrackerError::None;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") bool bTrackerProcessRunning = false;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") float CameraFps = 0.0f;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") float InferenceMs = 0.0f;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") float PipelineLatencyMs = 0.0f;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") int32 CameraWidth = 0;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") int32 CameraHeight = 0;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") FString ModelName;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") int64 PacketsAccepted = 0;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") int64 PacketsRejected = 0;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") int64 PacketsLost = 0;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") int64 PunchesAccepted = 0;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") int64 PunchesStale = 0;
};

USTRUCT(BlueprintType)
struct IRONECHO_API FIronEchoHudState
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") int32 SchemaVersion = IRONECHO_VISUAL_CONTRACT_VERSION;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") EIronEchoMatchMode Mode = EIronEchoMatchMode::Training;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") EIronEchoBotLevel BotLevel = EIronEchoBotLevel::Normal;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") EIronEchoMatchPhase Phase = EIronEchoMatchPhase::WaitingForPlayer;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") EIronEchoMatchPhase ResumePhase = EIronEchoMatchPhase::Fighting;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") EIronEchoPauseReason PauseReason = EIronEchoPauseReason::None;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") int32 Round = 0;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") int32 Rounds = 0;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") float RoundTimeRemaining = 0.0f;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") float CountdownRemaining = 0.0f;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") float BreakRemaining = 0.0f;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") int32 ScorePlayer = 0;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") int32 ScoreOpponent = 0;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") EIronEchoResultMethod Result = EIronEchoResultMethod::None;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") bool bHasWinner = false;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") EIronEchoFighterRole Winner = EIronEchoFighterRole::Player;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") int32 TrainingHits = 0;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") int32 SchemaMinor = IRONECHO_VISUAL_CONTRACT_MINOR;
	/** Final verdict of the three judges (Decision / Draw). */
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") EIronEchoDecisionKind Decision = EIronEchoDecisionKind::None;
	/** Judges' cumulative cards, index = judge (0 neutral, 1 volume, 2 defence). */
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") TArray<int32> JudgeScoresPlayer;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") TArray<int32> JudgeScoresOpponent;
	/** Referee count 0..10 during Phase == Knockdown. */
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") int32 KnockdownCount = 0;
	/** Player down: progress 0..100 of "raise and hold the guard to get up". */
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") int32 GetUpProgress = 0;
	/** Everyone is up; seconds until "box!". */
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") float ResumeIn = 0.0f;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") FIronEchoFighterHud Player;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") FIronEchoFighterHud Opponent;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") FIronEchoTrackingHud Tracking;
};

USTRUCT(BlueprintType)
struct IRONECHO_API FIronEchoCombatEvent
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") EIronEchoCombatEventType Type = EIronEchoCombatEventType::AttackStarted;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") EIronEchoFighterRole Actor = EIronEchoFighterRole::Player;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") EIronEchoFighterRole Target = EIronEchoFighterRole::Opponent;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") EIronEchoHand Hand = EIronEchoHand::Left;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") EIronEchoDodge Dodge = EIronEchoDodge::None;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") bool bCounterHit = false;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") bool bTired = false;
	/** Contract 2: the punch went to the body. */
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") bool bBodyShot = false;
	/** Contract 2.1: the attack was a kick (bBodyShot = mid kick; with bLowKick = low kick). */
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") bool bKick = false;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") bool bLowKick = false;
	/** Contract 2: a graze (HitConfirmed): reduced damage, show a lighter reaction. */
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") bool bGlancing = false;
	/** Contract 2: too close, the arm was not extended (HitConfirmed / Blocked): a short, jammed punch. */
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") bool bSmothered = false;
	/** Contract 2: fraction of the punch's full damage that landed (distance and graze), 0..1. */
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") float Power = 1.0f;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") float Damage = 0.0f;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") float TargetHealthAfter = 0.0f;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") int32 AttackId = 0;
	/** HitConfirmed: consecutive clean hits by Actor (1 = single). */
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") int32 ComboCount = 0;
	/** KnockedDown / GotUp: the Actor's knockdown number in this match. */
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") int32 KnockdownNumber = 0;
	/** HitConfirmed / Blocked / GuardBroken: world location of the contact (target's hit_head socket or fallback). */
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") FVector ImpactLocation = FVector::ZeroVector;
	/** Unit vector from attacker toward target along the fight line. */
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") FVector ImpactDirection = FVector::ForwardVector;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") float WorldTime = 0.0f;
};

USTRUCT(BlueprintType)
struct IRONECHO_API FIronEchoMatchEvent
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") EIronEchoMatchEventType Type = EIronEchoMatchEventType::PhaseChanged;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") EIronEchoMatchPhase Phase = EIronEchoMatchPhase::WaitingForPlayer;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") EIronEchoMatchPhase PreviousPhase = EIronEchoMatchPhase::WaitingForPlayer;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") EIronEchoPauseReason Reason = EIronEchoPauseReason::None;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") EIronEchoResultMethod Method = EIronEchoResultMethod::None;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") bool bHasWinner = false;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") EIronEchoFighterRole Winner = EIronEchoFighterRole::Player;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") int32 Round = 0;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") int32 CountdownSeconds = 0;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") int32 ScorePlayer = 0;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") int32 ScoreOpponent = 0;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") EIronEchoDecisionKind Decision = EIronEchoDecisionKind::None;
	/** KnockdownCount: who is down (CountdownSeconds carries the count 1..10). */
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") bool bHasDowned = false;
	UPROPERTY(BlueprintReadOnly, Category = "IronEcho") EIronEchoFighterRole Downed = EIronEchoFighterRole::Player;
};

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FIronEchoCombatEventSignature, const FIronEchoCombatEvent&, Event);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FIronEchoMatchEventSignature, const FIronEchoMatchEvent&, Event);
