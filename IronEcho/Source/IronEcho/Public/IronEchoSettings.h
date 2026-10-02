// Project settings (Config/DefaultGame.ini, section [/Script/IronEcho.IronEchoSettings]).
// Machine-specific paths never go here: they live in Tools/local.settings.json (gitignored).
#pragma once

#include "CoreMinimal.h"
#include "Engine/DeveloperSettings.h"
#include "IronEchoTypes.h"

#include "IronEchoSettings.generated.h"

UENUM()
enum class EIronEchoTrackerLaunchMode : uint8
{
	/** Packaged tracker if present, else the developer venv, else External. */
	Auto,
	/** <ProjectDir>/Tracker/IronEchoTracker.exe (shipping layout). */
	Packaged,
	/** <ProjectDir>/Tracking/.venv python -m iron_echo_tracker (developer layout). */
	DevPython,
	/** Started by hand (e.g. "python -m iron_echo_tracker run --preview"); the game only listens. */
	External,
	/** No tracker; keyboard debug input only. */
	Disabled
};

UCLASS(Config = Game, DefaultConfig, meta = (DisplayName = "IRON ECHO"))
class IRONECHO_API UIronEchoSettings : public UDeveloperSettings
{
	GENERATED_BODY()

public:
	UIronEchoSettings();

	// ---- Tracker process ----
	UPROPERTY(Config, EditAnywhere, Category = "Tracker") EIronEchoTrackerLaunchMode TrackerLaunchMode = EIronEchoTrackerLaunchMode::Auto;
	UPROPERTY(Config, EditAnywhere, Category = "Tracker") FString PackagedTrackerRelativePath = TEXT("Tracker/IronEchoTracker.exe");
	UPROPERTY(Config, EditAnywhere, Category = "Tracker") FString DevTrackerPythonRelativePath = TEXT("Tracking/.venv/Scripts/python.exe");
	UPROPERTY(Config, EditAnywhere, Category = "Tracker") int32 CameraIndex = 0;
	UPROPERTY(Config, EditAnywhere, Category = "Tracker") FString TrackerModel = TEXT("full");
	UPROPERTY(Config, EditAnywhere, Category = "Tracker") FString TrackerExtraArgs;
	UPROPERTY(Config, EditAnywhere, Category = "Tracker") int32 MaxTrackerRestarts = 3;

	// ---- Local protocol ----
	UPROPERTY(Config, EditAnywhere, Category = "Protocol") int32 GameListenPort = 47810;
	UPROPERTY(Config, EditAnywhere, Category = "Protocol") int32 TrackerControlPort = 47811;
	UPROPERTY(Config, EditAnywhere, Category = "Protocol") float LivenessTimeoutSeconds = 0.35f;
	UPROPERTY(Config, EditAnywhere, Category = "Protocol") float MaxPipelineLatencySeconds = 0.25f;
	UPROPERTY(Config, EditAnywhere, Category = "Protocol") float MaxEventAgeSeconds = 0.25f;

	// ---- Input interpretation (game side hysteresis) ----
	UPROPERTY(Config, EditAnywhere, Category = "Input") float BlockEnter = 0.60f;
	UPROPERTY(Config, EditAnywhere, Category = "Input") float BlockExit = 0.45f;
	UPROPERTY(Config, EditAnywhere, Category = "Input") float DodgeEnter = 0.55f;
	UPROPERTY(Config, EditAnywhere, Category = "Input") float DodgeExit = 0.40f;
	UPROPERTY(Config, EditAnywhere, Category = "Input") EIronEchoInputSource DefaultInputSource = EIronEchoInputSource::Tracker;

	// ---- Match ----
	UPROPERTY(Config, EditAnywhere, Category = "Match") EIronEchoMatchMode StartMode = EIronEchoMatchMode::Training;
	UPROPERTY(Config, EditAnywhere, Category = "Match") EIronEchoBotLevel BotLevel = EIronEchoBotLevel::Normal;
	UPROPERTY(Config, EditAnywhere, Category = "Match", meta = (ClampMin = "1", ClampMax = "12")) int32 Rounds = 3;
	UPROPERTY(Config, EditAnywhere, Category = "Match", meta = (ClampMin = "10")) float RoundSeconds = 90.0f;
	UPROPERTY(Config, EditAnywhere, Category = "Match", meta = (ClampMin = "1")) float BreakSeconds = 8.0f;
	/** 0 = new random seed per match. */
	UPROPERTY(Config, EditAnywhere, Category = "Match") int32 BotSeed = 0;

	// ---- Integration with Codex's content (soft paths, never hard references) ----
	UPROPERTY(Config, EditAnywhere, Category = "Visuals", meta = (AllowedClasses = "/Script/IronEcho.IronEchoVisualConfig"))
	FSoftObjectPath VisualConfig;
	/** Tech gym (floor + lights) is spawned only when the map has no AIronEchoRingAnchor. */
	UPROPERTY(Config, EditAnywhere, Category = "Visuals") bool bSpawnTechGymWhenNoAnchor = true;
	UPROPERTY(Config, EditAnywhere, Category = "Visuals") bool bShowDebugOverlay = true;
};
