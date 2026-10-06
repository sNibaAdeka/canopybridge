#include "IronEchoGameMode.h"

#include "Blueprint/UserWidget.h"
#include "Camera/CameraActor.h"
#include "Camera/CameraComponent.h"
#include "Components/LightComponent.h"
#include "Components/SpotLightComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/DirectionalLight.h"
#include "Engine/PostProcessVolume.h"
#include "Engine/SpotLight.h"
#include "Engine/StaticMesh.h"
#include "Engine/StaticMeshActor.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "IronEchoConversions.h"
#include "IronEchoDebugHUD.h"
#include "IronEchoFighter.h"
#include "IronEchoGameState.h"
#include "IronEchoPlayerController.h"
#include "IronEchoPunchingBag.h"
#include "IronEchoRingAnchor.h"
#include "IronEchoSettings.h"
#include "IronEchoTrackingSubsystem.h"
#include "IronEchoVisualConfig.h"
#include "Kismet/GameplayStatics.h"

namespace IronEchoModeLocal
{
	constexpr float CameraBack = 380.0f;
	constexpr float CameraSide = 150.0f;
	constexpr float CameraHeight = 215.0f;
	constexpr float LookHeight = 150.0f;
}

AIronEchoGameMode::AIronEchoGameMode()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.TickGroup = TG_PrePhysics;
	GameStateClass = AIronEchoGameState::StaticClass();
	PlayerControllerClass = AIronEchoPlayerController::StaticClass();
	HUDClass = AIronEchoDebugHUD::StaticClass();
	DefaultPawnClass = nullptr; // robots are driven by the rules, not possessed
}

void AIronEchoGameMode::StartPlay()
{
	Super::StartPlay();
	const UIronEchoSettings* Settings = GetDefault<UIronEchoSettings>();
	InputSource = Settings->TrackerLaunchMode == EIronEchoTrackerLaunchMode::Disabled ? EIronEchoInputSource::Keyboard : Settings->DefaultInputSource;
	BotLevel = Settings->BotLevel;
	EnsureArena();
	RebuildMatch(IronEchoConvert::ToCore(Settings->StartMode), BotLevel);
}

void AIronEchoGameMode::HandleStartingNewPlayer_Implementation(APlayerController* NewPlayer)
{
	// No pawn: the player's body is read from the camera; the view is a camera actor.
	InitializeHUDForPlayer(NewPlayer);
	EnsureArena();
	SetupView(NewPlayer);
}

void AIronEchoGameMode::EnsureArena()
{
	if (bArenaReady)
	{
		return;
	}
	UWorld* World = GetWorld();
	if (World == nullptr)
	{
		return;
	}
	bArenaReady = true;
	const UIronEchoSettings* Settings = GetDefault<UIronEchoSettings>();

	if (Settings->VisualConfig.IsValid())
	{
		VisualConfig = Cast<UIronEchoVisualConfig>(Settings->VisualConfig.TryLoad());
		UE_LOG(LogIronEcho, Log, TEXT("Visual config %s: %s"), *Settings->VisualConfig.ToString(), VisualConfig ? TEXT("loaded") : TEXT("not found, using placeholders"));
	}

	for (TActorIterator<AIronEchoRingAnchor> It(World); It; ++It)
	{
		RingTransform = It->GetActorTransform();
		RingTransform.SetScale3D(FVector::OneVector);
		bHasAnchor = true;
		break;
	}
	if (!bHasAnchor && Settings->bSpawnTechGymWhenNoAnchor)
	{
		SpawnTechGym();
	}

	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	PlayerFighter = World->SpawnActor<AIronEchoFighter>(AIronEchoFighter::StaticClass(), RingTransform, Params);
	OpponentFighter = World->SpawnActor<AIronEchoFighter>(AIronEchoFighter::StaticClass(), RingTransform, Params);
	Bag = World->SpawnActor<AIronEchoPunchingBag>(AIronEchoPunchingBag::StaticClass(), RingTransform, Params);

	USkeletalMesh* PlayerMesh = nullptr;
	USkeletalMesh* OpponentMesh = nullptr;
	UClass* AnimClass = nullptr;
	if (VisualConfig != nullptr)
	{
		PlayerMesh = VisualConfig->PlayerRobotMesh.LoadSynchronous();
		OpponentMesh = VisualConfig->OpponentRobotMesh.IsNull() ? PlayerMesh : VisualConfig->OpponentRobotMesh.LoadSynchronous();
		AnimClass = VisualConfig->RobotAnimClass.LoadSynchronous();
		if (Bag != nullptr)
		{
			Bag->SetBagMesh(VisualConfig->PunchingBagMesh.LoadSynchronous());
		}
	}
	if (PlayerFighter != nullptr)
	{
		PlayerFighter->SetupVisuals(EIronEchoFighterRole::Player, PlayerMesh, AnimClass);
	}
	if (OpponentFighter != nullptr)
	{
		OpponentFighter->SetupVisuals(EIronEchoFighterRole::Opponent, OpponentMesh, AnimClass);
	}
}

void AIronEchoGameMode::SpawnTechGym()
{
	UWorld* World = GetWorld();
	UStaticMesh* Plane = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Plane.Plane"));
	UStaticMesh* Cylinder = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;

	auto SpawnMesh = [&](UStaticMesh* Mesh, const FVector& Location, const FVector& Scale) {
		AStaticMeshActor* Actor = World->SpawnActor<AStaticMeshActor>(AStaticMeshActor::StaticClass(), FTransform(FRotator::ZeroRotator, Location, Scale), Params);
		if (Actor != nullptr && Mesh != nullptr)
		{
			Actor->GetStaticMeshComponent()->SetMobility(EComponentMobility::Movable);
			Actor->GetStaticMeshComponent()->SetStaticMesh(Mesh);
			Actor->GetStaticMeshComponent()->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		}
		return Actor;
	};
	SpawnMesh(Plane, FVector::ZeroVector, FVector(14.0f, 14.0f, 1.0f));
	const float Corner = 330.0f;
	for (int32 Index = 0; Index < 4; ++Index)
	{
		const FVector Location((Index & 1) ? Corner : -Corner, (Index & 2) ? Corner : -Corner, 75.0f);
		SpawnMesh(Cylinder, Location, FVector(0.15f, 0.15f, 1.5f));
	}

	// TV-boxing rig as in the realistic arena (Tools/Blender/Realistic/ring.py): hard spots from a square truss over
	// the ring give crisp, overlapping contact shadows under the robots; a weak shadowless fill keeps the dark side readable.
	const float TrussHalf = 390.0f;
	const float TrussHeight = 620.0f;
	const float SpotOffsets[] = {-260.0f, 260.0f};
	for (int32 Side = 0; Side < 4; ++Side)
	{
		const FRotator SideRot(0.0f, 90.0f * static_cast<float>(Side), 0.0f);
		for (const float Offset : SpotOffsets)
		{
			const FVector Location = SideRot.RotateVector(FVector(TrussHalf, Offset, TrussHeight));
			const FVector Target(Location.X * 0.1f, Location.Y * 0.1f, 120.0f);
			ASpotLight* Spot = World->SpawnActor<ASpotLight>(ASpotLight::StaticClass(), FTransform((Target - Location).Rotation(), Location), Params);
			USpotLightComponent* Light = Spot != nullptr ? Cast<USpotLightComponent>(Spot->GetLightComponent()) : nullptr;
			if (Light == nullptr)
			{
				continue;
			}
			Light->SetMobility(EComponentMobility::Movable);
			Light->SetIntensityUnits(ELightUnits::Candelas);
			Light->SetIntensity(45.0f);
			Light->SetLightColor(FLinearColor(1.0f, 0.95f, 0.88f));
			Light->SetOuterConeAngle(30.0f);
			Light->SetInnerConeAngle(18.0f);
			Light->SetSourceRadius(4.0f);
			Light->SetAttenuationRadius(1500.0f);
			Light->SetCastShadows(true);
			Light->ContactShadowLength = 0.05f;
			Light->MarkRenderStateDirty();
		}
	}
	ADirectionalLight* Fill = World->SpawnActor<ADirectionalLight>(ADirectionalLight::StaticClass(), FTransform(FRotator(-30.0f, -150.0f, 0.0f)), Params);
	if (Fill != nullptr)
	{
		Fill->GetLightComponent()->SetMobility(EComponentMobility::Movable);
		Fill->GetLightComponent()->SetIntensity(0.8f);
		Fill->GetLightComponent()->SetCastShadows(false);
	}
	APostProcessVolume* Post = World->SpawnActor<APostProcessVolume>(APostProcessVolume::StaticClass(), FTransform::Identity, Params);
	if (Post != nullptr)
	{
		// Fixed exposure: the gym has no sky, auto exposure would pump.
		Post->bUnbound = true;
		Post->Settings.bOverride_AutoExposureMinBrightness = true;
		Post->Settings.bOverride_AutoExposureMaxBrightness = true;
		Post->Settings.AutoExposureMinBrightness = 1.0f;
		Post->Settings.AutoExposureMaxBrightness = 1.0f;
	}
}

void AIronEchoGameMode::SetupView(APlayerController* Player)
{
	if (Player == nullptr)
	{
		return;
	}
	UWorld* World = GetWorld();
	if (ViewCamera == nullptr && World != nullptr)
	{
		FActorSpawnParameters Params;
		Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
		UClass* CameraClass = (VisualConfig != nullptr) ? VisualConfig->GameCameraClass.LoadSynchronous() : nullptr;
		if (CameraClass != nullptr)
		{
			ViewCamera = World->SpawnActor<AActor>(CameraClass, RingTransform, Params);
		}
		if (ViewCamera == nullptr)
		{
			using namespace IronEchoModeLocal;
			const FVector Eye = RingTransform.TransformPosition(FVector(-CameraBack, CameraSide, CameraHeight));
			const FVector Look = RingTransform.TransformPosition(FVector(0.0f, 0.0f, LookHeight));
			ACameraActor* Camera = World->SpawnActor<ACameraActor>(ACameraActor::StaticClass(), FTransform((Look - Eye).Rotation(), Eye), Params);
			if (Camera != nullptr)
			{
				Camera->GetCameraComponent()->SetFieldOfView(70.0f);
			}
			ViewCamera = Camera;
			bFallbackCamera = Camera != nullptr;
		}
	}
	if (ViewCamera != nullptr)
	{
		Player->SetViewTarget(ViewCamera);
	}
	if (VisualConfig != nullptr && HudWidget == nullptr)
	{
		if (UClass* WidgetClass = VisualConfig->HudWidgetClass.LoadSynchronous())
		{
			HudWidget = CreateWidget<UUserWidget>(Player, WidgetClass);
			if (HudWidget != nullptr)
			{
				HudWidget->AddToViewport();
				if (VisualConfig->bHideDebugOverlay)
				{
					if (AIronEchoPlayerController* Controller = Cast<AIronEchoPlayerController>(Player))
					{
						Controller->SetDebugOverlayVisible(false);
					}
				}
			}
		}
	}
}

AIronEchoGameState* AIronEchoGameMode::GetIronEchoGameState() const
{
	return GetGameState<AIronEchoGameState>();
}

AIronEchoFighter* AIronEchoGameMode::GetFighter(EIronEchoFighterRole Role) const
{
	return Role == EIronEchoFighterRole::Player ? PlayerFighter.Get() : OpponentFighter.Get();
}

uint64 AIronEchoGameMode::MakeSeed() const
{
	const int32 Configured = GetDefault<UIronEchoSettings>()->BotSeed;
	if (Configured != 0)
	{
		return static_cast<uint64>(Configured);
	}
	return static_cast<uint64>(FPlatformTime::Cycles64()) ^ (static_cast<uint64>(FMath::Rand()) << 32);
}

void AIronEchoGameMode::RebuildMatch(IronEchoCore::MatchMode Mode, EIronEchoBotLevel Level)
{
	const UIronEchoSettings* Settings = GetDefault<UIronEchoSettings>();
	IronEchoCore::MatchSetup Setup;
	Setup.Mode = Mode;
	Setup.Seed = MakeSeed();
	Setup.Rules.Rounds = FMath::Clamp(Settings->Rounds, 1, 12);
	Setup.Rules.RoundTicks = IronEchoCore::SecondsToTicks(FMath::Max(10.0f, Settings->RoundSeconds));
	Setup.Rules.BreakTicks = IronEchoCore::SecondsToTicks(FMath::Max(1.0f, Settings->BreakSeconds));
	Setup.Bot = IronEchoCore::MakeBotConfig(IronEchoConvert::ToCore(Level));
	Setup.OpponentFighter = IronEchoCore::MakeBotFighterConfig(IronEchoConvert::ToCore(Level));
	if (bHasAnchor)
	{
		for (TActorIterator<AIronEchoRingAnchor> It(GetWorld()); It; ++It)
		{
			// UsableHalfLength: how far a fighter's centre may go from the anchor, now on both axes (square ring).
			Setup.Movement.RingHalfSize = FMath::Max(1.5f, It->UsableHalfLength / IronEchoConvert::MetersToCm) + Setup.Movement.FighterRadius;
			break;
		}
	}
	Match = MakeUnique<IronEchoCore::Match>(Setup);

	IronEchoCore::IntentConfig Intent;
	Intent.BlockEnter = Settings->BlockEnter;
	Intent.BlockExit = Settings->BlockExit;
	Intent.DodgeEnter = Settings->DodgeEnter;
	Intent.DodgeExit = Settings->DodgeExit;
	Mapper.SetConfig(Intent);
	Mapper.Reset();
	CarriedPunches = IronEchoCore::FighterIntent();
	CombatEvents.Clear();
	MatchEvents.Clear();
	Accumulator = 0.0;
	BotLevel = Level;
	for (FReactionMemory& Memory : Reactions)
	{
		Memory = FReactionMemory();
	}
	UE_LOG(LogIronEcho, Log, TEXT("Match rebuilt: mode=%s bot=%s seed=%llu"), Mode == IronEchoCore::MatchMode::Training ? TEXT("Training") : TEXT("Bout"),
		ANSI_TO_TCHAR(IronEchoCore::BotLevelName(IronEchoConvert::ToCore(Level))), static_cast<unsigned long long>(Setup.Seed));
}

void AIronEchoGameMode::StartBout(EIronEchoBotLevel Level)
{
	RebuildMatch(IronEchoCore::MatchMode::Bout, Level);
}

void AIronEchoGameMode::StartTraining()
{
	RebuildMatch(IronEchoCore::MatchMode::Training, BotLevel);
}

void AIronEchoGameMode::TogglePause()
{
	if (Match.IsValid() && Match->Snapshot().Phase == IronEchoCore::MatchPhase::Paused)
	{
		RequestResume();
	}
	else
	{
		RequestPause();
	}
}

void AIronEchoGameMode::RequestPause()
{
	if (Match.IsValid())
	{
		Match->RequestPause();
	}
}

void AIronEchoGameMode::RequestResume()
{
	if (Match.IsValid())
	{
		Match->RequestResume();
	}
}

void AIronEchoGameMode::RequestRematch()
{
	if (Match.IsValid())
	{
		Match->RequestRematch();
	}
}

void AIronEchoGameMode::RequestCalibration(bool bFull)
{
	if (UIronEchoTrackingSubsystem* Tracking = GetGameInstance()->GetSubsystem<UIronEchoTrackingSubsystem>())
	{
		Tracking->RequestCalibration(bFull);
	}
}

void AIronEchoGameMode::SetInputSource(EIronEchoInputSource Source)
{
	InputSource = Source;
	Mapper.Reset();
	UE_LOG(LogIronEcho, Log, TEXT("Input source: %s"), Source == EIronEchoInputSource::Tracker ? TEXT("Tracker") : TEXT("Keyboard (debug)"));
}

IronEchoCore::InputFrame AIronEchoGameMode::GatherInput()
{
	UIronEchoTrackingSubsystem* Tracking = GetGameInstance() ? GetGameInstance()->GetSubsystem<UIronEchoTrackingSubsystem>() : nullptr;
	IronEchoCore::InputFrame TrackerFrame;
	if (Tracking != nullptr)
	{
		Tracking->Poll();
		TrackerFrame = Tracking->BuildInputFrame(); // always drained, so a source switch never replays old punches
	}
	if (InputSource == EIronEchoInputSource::Keyboard)
	{
		if (AIronEchoPlayerController* Controller = Cast<AIronEchoPlayerController>(UGameplayStatics::GetPlayerController(this, 0)))
		{
			return Controller->ConsumeKeyboardFrame();
		}
	}
	return TrackerFrame;
}

void AIronEchoGameMode::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	if (!Match.IsValid())
	{
		return;
	}
	const IronEchoCore::InputFrame Frame = GatherInput();
	StepSimulation(DeltaSeconds, Frame);
	PushVisuals(DeltaSeconds, Frame);
	DispatchEvents();
	UpdateHudState();
}

void AIronEchoGameMode::StepSimulation(float DeltaSeconds, const IronEchoCore::InputFrame& Frame)
{
	IronEchoCore::MatchInput Input;
	Input.bInputReady = Frame.Status == IronEchoCore::TrackingStatus::Live;
	Input.PlayerIntent = Mapper.Map(Frame);
	bLastInputReady = Input.bInputReady;

	// Punches seen in a frame without a simulation tick (render rate > 120 Hz) are carried to the next tick.
	for (int32 Index = 0; Index < CarriedPunches.PunchCount; ++Index)
	{
		Input.PlayerIntent.AddPunch(CarriedPunches.Punches[Index].PunchHand, CarriedPunches.Punches[Index].Strength);
	}
	CarriedPunches.PunchCount = 0;

	Accumulator += FMath::Min(static_cast<double>(DeltaSeconds), 0.25);
	bool bTicked = false;
	while (Accumulator >= IronEchoCore::kTickSeconds)
	{
		Accumulator -= IronEchoCore::kTickSeconds;
		Match->Tick(Input, CombatEvents, MatchEvents);
		Input.PlayerIntent.PunchCount = 0; // punches apply to the first sub-step only
		bTicked = true;
	}
	if (!bTicked)
	{
		CarriedPunches = Input.PlayerIntent;
	}
}

FTransform AIronEchoGameMode::SlotTransform(IronEchoCore::FighterSlot Slot) const
{
	// Core ring frame is right-handed (Y to the player's starting left); Unreal is left-handed: Y and yaw flip.
	const IronEchoCore::FighterSnapshot& S = Match->Sim().Get(Slot).Snapshot();
	const FRotator Facing(0.0f, -FMath::RadiansToDegrees(FMath::Atan2(S.Facing.Y, S.Facing.X)), 0.0f);
	const FVector Location(S.Location.X * IronEchoConvert::MetersToCm, -S.Location.Y * IronEchoConvert::MetersToCm, 0.0f);
	return FTransform(Facing, Location) * RingTransform;
}

FIronEchoFighterVisualState AIronEchoGameMode::MakeVisualState(IronEchoCore::FighterSlot Slot, const IronEchoCore::InputFrame& Frame) const
{
	const IronEchoCore::FighterSnapshot& S = Match->Sim().Get(Slot).Snapshot();
	const FReactionMemory& Memory = Reactions[IronEchoCore::SlotIndex(Slot)];
	const float TickSeconds = static_cast<float>(IronEchoCore::kTickSeconds);

	FIronEchoFighterVisualState V;
	V.Role = IronEchoConvert::ToUnreal(Slot);
	V.MatchPhase = IronEchoConvert::ToUnreal(Match->Snapshot().Phase);
	V.ActionState = IronEchoConvert::ToUnreal(S.State);
	V.AttackStage = IronEchoConvert::ToUnreal(S.Stage);
	V.AttackHand = IronEchoConvert::ToUnreal(S.AttackHand);
	V.AttackStageAlpha = S.StageAlpha();
	V.AttackStageDuration = static_cast<float>(S.StageTicksTotal) * TickSeconds;
	V.AttackId = static_cast<int32>(S.AttackId);
	V.bAttackTired = S.bAttackTired;
	V.StunRemaining = static_cast<float>(S.StateTicksLeft) * TickSeconds;
	V.bBlocking = S.bBlocking;
	V.BlockAlpha = Memory.BlockAlpha;
	V.Dodge = IronEchoConvert::ToUnreal(S.Dodge);
	V.bDodgeEffective = S.bDodgeEffective;
	V.LeanLateral = S.LeanLateral;
	V.Health01 = S.MaxHealth > 0.0f ? S.Health / S.MaxHealth : 0.0f;
	V.Stamina01 = S.MaxStamina > 0.0f ? S.Stamina / S.MaxStamina : 0.0f;
	V.bKnockedOut = S.State == IronEchoCore::ActionState::KnockedOut;
	V.bKnockedDown = S.State == IronEchoCore::ActionState::KnockedDown;
	V.KnockdownsSuffered = S.KnockdownsSuffered;
	V.ComboCount = S.ComboCount;
	V.DistanceToOpponent = Match->Sim().Gap() * IronEchoConvert::MetersToCm;
	V.MoveForwardSpeed = S.SpeedForward * IronEchoConvert::MetersToCm;
	V.MoveRightSpeed = S.SpeedSide * IronEchoConvert::MetersToCm;
	V.HeadSlip = S.HeadOffset * IronEchoConvert::MetersToCm;
	V.bOnRopes = S.bOnRopes;
	V.bBodyShot = S.AttackZone == IronEchoCore::PunchZone::Body;
	V.LastHitTakenTime = Memory.LastHitTakenTime;
	V.LastHitTakenFromHand = Memory.LastHitFromHand;
	V.HitsTaken = Memory.HitsTaken;
	V.LastBlockTime = Memory.LastBlockTime;

	const bool bFree = S.State == IronEchoCore::ActionState::Guard || S.State == IronEchoCore::ActionState::Block;
	if (Slot == IronEchoCore::FighterSlot::Player && Frame.Status == IronEchoCore::TrackingStatus::Live)
	{
		// The robot continuously mirrors the player's stance; punches are game-processed instead.
		V.LeanForward = FMath::Clamp(Frame.LeanForward, -1.0f, 1.0f);
		V.HandTargetLeft = IronEchoConvert::ToUnreal(Frame.HandPos[0]);
		V.HandTargetRight = IronEchoConvert::ToUnreal(Frame.HandPos[1]);
		V.HandTrackingAlphaLeft = bFree ? 1.0f : 0.0f;
		V.HandTrackingAlphaRight = bFree ? 1.0f : 0.0f;
	}
	else
	{
		V.HandTrackingAlphaLeft = 0.0f;
		V.HandTrackingAlphaRight = 0.0f;
	}
	return V;
}

void AIronEchoGameMode::PushVisuals(float DeltaSeconds, const IronEchoCore::InputFrame& Frame)
{
	const bool bTraining = Match->Snapshot().Mode == IronEchoCore::MatchMode::Training;
	for (int32 Index = 0; Index < 2; ++Index)
	{
		const IronEchoCore::FighterSnapshot& S = Match->Sim().Get(Index == 0 ? IronEchoCore::FighterSlot::Player : IronEchoCore::FighterSlot::Opponent).Snapshot();
		const float Blend = 1.0f - FMath::Exp(-DeltaSeconds * 15.0f);
		Reactions[Index].BlockAlpha = FMath::Lerp(Reactions[Index].BlockAlpha, S.bBlocking ? 1.0f : 0.0f, Blend);
	}
	if (PlayerFighter != nullptr)
	{
		PlayerFighter->ApplyVisualState(MakeVisualState(IronEchoCore::FighterSlot::Player, Frame), SlotTransform(IronEchoCore::FighterSlot::Player), DeltaSeconds);
	}
	if (OpponentFighter != nullptr)
	{
		OpponentFighter->SetActorHiddenInGame(bTraining);
		OpponentFighter->ApplyVisualState(MakeVisualState(IronEchoCore::FighterSlot::Opponent, Frame), SlotTransform(IronEchoCore::FighterSlot::Opponent), DeltaSeconds);
	}
	if (Bag != nullptr)
	{
		Bag->SetActorHiddenInGame(!bTraining);
		Bag->UpdateBag(SlotTransform(IronEchoCore::FighterSlot::Opponent), DeltaSeconds);
	}
	UpdateFallbackCamera(DeltaSeconds);
}

void AIronEchoGameMode::UpdateFallbackCamera(float DeltaSeconds)
{
	// The fallback camera (no Codex camera class) follows the fight line as the fighters circle: behind the player's
	// right shoulder, both robots in frame. A camera class from DA_IronEchoVisuals drives itself.
	if (!bFallbackCamera || ViewCamera == nullptr)
	{
		return;
	}
	using namespace IronEchoModeLocal;
	const FTransform PlayerT = SlotTransform(IronEchoCore::FighterSlot::Player);
	const FTransform OpponentT = SlotTransform(IronEchoCore::FighterSlot::Opponent);
	const FVector Mid = 0.5f * (PlayerT.GetLocation() + OpponentT.GetLocation());
	const FVector Line = (OpponentT.GetLocation() - PlayerT.GetLocation()).GetSafeNormal2D();
	const FVector Right = FVector::CrossProduct(FVector::UpVector, Line); // Unreal: Z x X = +Y (right)
	const FVector Eye = PlayerT.GetLocation() - Line * CameraBack + Right * CameraSide + FVector::UpVector * CameraHeight;
	const FVector Look = Mid + FVector::UpVector * (LookHeight - 40.0f);
	const float Blend = 1.0f - FMath::Exp(-DeltaSeconds * 4.0f);
	const FVector NewEye = FMath::Lerp(ViewCamera->GetActorLocation(), Eye, Blend);
	ViewCamera->SetActorLocationAndRotation(NewEye, (Look - NewEye).Rotation());
}

void AIronEchoGameMode::DispatchEvents()
{
	AIronEchoGameState* State = GetIronEchoGameState();
	const float Now = GetWorld() ? GetWorld()->GetTimeSeconds() : 0.0f;
	const bool bTraining = Match->Snapshot().Mode == IronEchoCore::MatchMode::Training;

	for (const IronEchoCore::CombatEvent& Core : CombatEvents)
	{
		FIronEchoCombatEvent Event;
		Event.Type = IronEchoConvert::ToUnreal(Core.Type);
		Event.Actor = IronEchoConvert::ToUnreal(Core.Actor);
		Event.Target = IronEchoConvert::ToUnreal(Core.Target);
		Event.Hand = IronEchoConvert::ToUnreal(Core.AttackHand);
		Event.Dodge = IronEchoConvert::ToUnreal(Core.Dodge);
		Event.bCounterHit = Core.bCounterHit;
		Event.bBodyShot = Core.Zone == IronEchoCore::PunchZone::Body;
		Event.bGlancing = Core.bGlancing;
		Event.bSmothered = Core.bSmothered;
		Event.Power = Core.Power;
		Event.bTired = Core.bTired;
		Event.Damage = Core.Damage;
		Event.TargetHealthAfter = Core.TargetHealthAfter;
		Event.AttackId = static_cast<int32>(Core.AttackId);
		Event.ComboCount = Core.ComboCount;
		Event.KnockdownNumber = Core.KnockdownNumber;
		Event.WorldTime = Now;
		Event.ImpactDirection = RingTransform.TransformVectorNoScale(Core.Actor == IronEchoCore::FighterSlot::Player ? FVector::ForwardVector : -FVector::ForwardVector);

		const bool bContact = Core.Type == IronEchoCore::CombatEventType::HitConfirmed || Core.Type == IronEchoCore::CombatEventType::Blocked
			|| Core.Type == IronEchoCore::CombatEventType::GuardBroken;
		if (bContact)
		{
			const bool bTargetIsBag = bTraining && Core.Target == IronEchoCore::FighterSlot::Opponent;
			AIronEchoFighter* Target = Core.Target == IronEchoCore::FighterSlot::Player ? PlayerFighter.Get() : OpponentFighter.Get();
			if (bTargetIsBag && Bag != nullptr)
			{
				Event.ImpactLocation = Bag->GetHitLocation();
			}
			else if (Target != nullptr)
			{
				Event.ImpactLocation = Target->GetHitLocation();
			}
			FReactionMemory& Memory = Reactions[IronEchoCore::SlotIndex(Core.Target)];
			if (Core.Type == IronEchoCore::CombatEventType::Blocked)
			{
				Memory.LastBlockTime = Now;
			}
			else if (Core.Type == IronEchoCore::CombatEventType::HitConfirmed)
			{
				Memory.LastHitTakenTime = Now;
				Memory.LastHitFromHand = Event.Hand;
				++Memory.HitsTaken;
				if (bTargetIsBag && Bag != nullptr)
				{
					Bag->OnConfirmedHit(Event.Hand, 1.0f);
				}
				UE_LOG(LogIronEcho, Log, TEXT("Confirmed hit: %s %s -> %s (%.1f dmg)"), Core.Actor == IronEchoCore::FighterSlot::Player ? TEXT("player") : TEXT("bot"),
					Core.AttackHand == IronEchoCore::Hand::Left ? TEXT("left") : TEXT("right"), bTargetIsBag ? TEXT("bag") : TEXT("robot"), Core.Damage);
			}
		}
		if (State != nullptr)
		{
			State->OnCombatEvent.Broadcast(Event);
		}
	}
	CombatEvents.Clear();

	for (const IronEchoCore::MatchEvent& Core : MatchEvents)
	{
		FIronEchoMatchEvent Event;
		Event.Type = IronEchoConvert::ToUnreal(Core.Type);
		Event.Phase = IronEchoConvert::ToUnreal(Core.Phase);
		Event.PreviousPhase = IronEchoConvert::ToUnreal(Core.PreviousPhase);
		Event.Reason = IronEchoConvert::ToUnreal(Core.Reason);
		Event.Method = IronEchoConvert::ToUnreal(Core.Method);
		Event.bHasWinner = Core.bHasWinner;
		Event.Winner = IronEchoConvert::ToUnreal(Core.Winner);
		Event.Round = Core.Round;
		Event.CountdownSeconds = Core.CountdownSeconds;
		Event.ScorePlayer = Core.ScorePlayer;
		Event.ScoreOpponent = Core.ScoreOpponent;
		Event.Decision = IronEchoConvert::ToUnreal(Core.Decision);
		Event.bHasDowned = Core.bHasDowned;
		Event.Downed = IronEchoConvert::ToUnreal(Core.Downed);
		if (Core.Type == IronEchoCore::MatchEventType::PhaseChanged)
		{
			UE_LOG(LogIronEcho, Log, TEXT("Match phase: %s"), ANSI_TO_TCHAR(IronEchoCore::MatchPhaseName(Core.Phase)));
		}
		else if (Core.Type == IronEchoCore::MatchEventType::MatchEnded)
		{
			UE_LOG(LogIronEcho, Log, TEXT("Match ended: method %d, decision %d, judges %d-%d / %d-%d / %d-%d"), static_cast<int32>(Core.Method),
				static_cast<int32>(Core.Decision), Match->Snapshot().JudgeScores[0][0], Match->Snapshot().JudgeScores[0][1],
				Match->Snapshot().JudgeScores[1][0], Match->Snapshot().JudgeScores[1][1], Match->Snapshot().JudgeScores[2][0], Match->Snapshot().JudgeScores[2][1]);
		}
		if (State != nullptr)
		{
			State->OnMatchEvent.Broadcast(Event);
		}
	}
	MatchEvents.Clear();
}

void AIronEchoGameMode::UpdateHudState()
{
	const IronEchoCore::MatchSnapshot& M = Match->Snapshot();
	const float TickSeconds = static_cast<float>(IronEchoCore::kTickSeconds);
	FIronEchoHudState Hud;
	Hud.Mode = IronEchoConvert::ToUnreal(M.Mode);
	Hud.BotLevel = BotLevel;
	Hud.Phase = IronEchoConvert::ToUnreal(M.Phase);
	Hud.ResumePhase = IronEchoConvert::ToUnreal(M.ResumePhase);
	Hud.PauseReason = IronEchoConvert::ToUnreal(M.Pause);
	Hud.Round = M.Round;
	Hud.Rounds = M.Rounds;
	Hud.RoundTimeRemaining = static_cast<float>(M.RoundTicksLeft) * TickSeconds;
	Hud.CountdownRemaining = static_cast<float>(M.CountdownTicksLeft) * TickSeconds;
	Hud.BreakRemaining = static_cast<float>(M.BreakTicksLeft) * TickSeconds;
	Hud.ScorePlayer = M.ScorePlayer;
	Hud.ScoreOpponent = M.ScoreOpponent;
	Hud.Result = IronEchoConvert::ToUnreal(M.Result);
	Hud.bHasWinner = M.bHasWinner;
	Hud.Winner = IronEchoConvert::ToUnreal(M.Winner);
	Hud.TrainingHits = M.TrainingHits;
	Hud.Decision = IronEchoConvert::ToUnreal(M.Decision);
	Hud.JudgeScoresPlayer.SetNum(IronEchoCore::kJudgeCount);
	Hud.JudgeScoresOpponent.SetNum(IronEchoCore::kJudgeCount);
	for (int32 Judge = 0; Judge < IronEchoCore::kJudgeCount; ++Judge)
	{
		Hud.JudgeScoresPlayer[Judge] = M.JudgeScores[Judge][0];
		Hud.JudgeScoresOpponent[Judge] = M.JudgeScores[Judge][1];
	}
	Hud.KnockdownCount = M.KnockdownCount;
	Hud.GetUpProgress = M.GetUpProgress;
	Hud.ResumeIn = static_cast<float>(M.PostGetUpTicksLeft) * TickSeconds;
	for (int32 Index = 0; Index < 2; ++Index)
	{
		const IronEchoCore::FighterSnapshot& S = Match->Sim().Get(Index == 0 ? IronEchoCore::FighterSlot::Player : IronEchoCore::FighterSlot::Opponent).Snapshot();
		FIronEchoFighterHud& F = Index == 0 ? Hud.Player : Hud.Opponent;
		F.Health = S.Health;
		F.MaxHealth = S.MaxHealth;
		F.Stamina = S.Stamina;
		F.MaxStamina = S.MaxStamina;
		F.ActionState = IronEchoConvert::ToUnreal(S.State);
		F.PunchesThrown = S.PunchesThrown;
		F.PunchesLanded = S.PunchesLanded;
		F.DodgesMade = S.DodgesMade;
		F.BlocksMade = S.BlocksMade;
		F.CounterHits = S.CounterHits;
		F.ComboCount = S.ComboCount;
		F.MaxCombo = S.MaxCombo;
		F.KnockdownsSuffered = S.KnockdownsSuffered;
		F.bKnockedDown = S.State == IronEchoCore::ActionState::KnockedDown;
	}
	if (UIronEchoTrackingSubsystem* Tracking = GetGameInstance() ? GetGameInstance()->GetSubsystem<UIronEchoTrackingSubsystem>() : nullptr)
	{
		Hud.Tracking = Tracking->GetTrackingHud();
	}
	Hud.Tracking.InputSource = InputSource;
	if (InputSource == EIronEchoInputSource::Keyboard)
	{
		Hud.Tracking.Status = EIronEchoTrackingStatus::Live;
	}
	HudState = Hud;
	if (AIronEchoGameState* State = GetIronEchoGameState())
	{
		State->SetHudState(Hud);
		State->SetArena(PlayerFighter, OpponentFighter, Bag, RingTransform);
	}
}
