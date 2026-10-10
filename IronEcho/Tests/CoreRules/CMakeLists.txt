# Standalone build of Source/IronEchoRules for unit tests (no Unreal required).
#   cmake -S Tests/CoreRules -B Build/CoreRulesTests -DCMAKE_BUILD_TYPE=Debug
#   cmake --build Build/CoreRulesTests && ctest --test-dir Build/CoreRulesTests --output-on-failure
cmake_minimum_required(VERSION 3.20)
project(IronEchoCoreRulesTests LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

option(IRONECHO_SANITIZE "Build with ASan + UBSan (GCC/Clang)" ON)

set(RULES_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../../Source/IronEchoRules)
file(GLOB RULES_SOURCES CONFIGURE_DEPENDS ${RULES_DIR}/Private/*.cpp)
list(FILTER RULES_SOURCES EXCLUDE REGEX ".*IronEchoRulesModule\\.cpp$")

add_library(IronEchoRulesCore STATIC ${RULES_SOURCES})
target_include_directories(IronEchoRulesCore PUBLIC ${RULES_DIR}/Public)

if(MSVC)
  # Mirror Unreal: no exceptions, no RTTI, warnings as errors.
  target_compile_options(IronEchoRulesCore PUBLIC /W4 /WX /permissive- /EHs-c- /GR- /D_HAS_EXCEPTIONS=0)
else()
  target_compile_options(IronEchoRulesCore PUBLIC -Wall -Wextra -Wshadow -Wconversion -Wpedantic -Werror -fno-exceptions -fno-rtti)
  if(IRONECHO_SANITIZE)
    target_compile_options(IronEchoRulesCore PUBLIC -fsanitize=address,undefined -fno-sanitize-recover=all -fno-omit-frame-pointer)
    target_link_options(IronEchoRulesCore PUBLIC -fsanitize=address,undefined)
  endif()
endif()

set(GOLDEN_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../Golden/protocol_v1)

add_executable(CoreRulesTests
  TestMain.cpp
  TestProtocol.cpp
  TestPacketGate.cpp
  TestIntent.cpp
  TestFighter.cpp
  TestRing.cpp
  TestMatch.cpp
  TestBot.cpp
  TestCloseRange.cpp
  TestBalance.cpp)
target_link_libraries(CoreRulesTests PRIVATE IronEchoRulesCore)
target_compile_definitions(CoreRulesTests PRIVATE IRONECHO_GOLDEN_DIR="${GOLDEN_DIR}")

enable_testing()
add_test(NAME CoreRulesTests COMMAND CoreRulesTests)

# Headless receiver: tracker UDP -> PacketGate -> IntentMapper -> Match(Training). POSIX sockets only.
if(UNIX)
  add_executable(IronEchoHeadless HeadlessReceiver.cpp)
  target_link_libraries(IronEchoHeadless PRIVATE IronEchoRulesCore)
endif()
