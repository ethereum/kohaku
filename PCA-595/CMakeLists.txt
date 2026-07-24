cmake_minimum_required(VERSION 3.20)
project(PCA-595 VERSION 2.2.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# --- Opções de build ---
option(PCA_BUILD_TESTS "Build unit tests" ON)
option(PCA_BUILD_MONITOR "Build PhiMonitor module" ON)
option(PCA_ENABLE_OPENGL "Enable OpenGL overlay" OFF)
option(PCA_USE_227F "Integrate with Constitutional Alignment Engine (227-F)" OFF)
option(PCA_USE_IIT_452 "Integrate with IIT Engine (452) for exact Phi computation" OFF)
option(PCA_USE_GRPC "Use gRPC for alignment service communication" OFF)
option(PCA_USE_REAL_DRIVER "Link against real IrisNetworkDriver" OFF)
option(PCA_BUILD_ASYNC "Build with C++20 async OR support" ON)

# --- Dependências ---
find_package(Threads REQUIRED)
find_package(CURL REQUIRED)
find_package(nlohmann_json REQUIRED)

if(PCA_BUILD_TESTS)
    find_package(GTest REQUIRED)
endif()

if(PCA_USE_GRPC)
    find_package(gRPC REQUIRED)
endif()

if(PCA_ENABLE_OPENGL)
    find_package(OpenGL REQUIRED)
endif()

# --- Biblioteca PCA-595 core (v2.2) ---
add_library(pca595_core STATIC
    PCA-595.cpp
    AlignmentClient.cpp
    PhiMeterIIT.cpp
)

if(PCA_BUILD_ASYNC)
    target_sources(pca595_core PRIVATE
        ConsciousnessCycleAsync.cpp
    )
endif()

target_include_directories(pca595_core PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${CURL_INCLUDE_DIRS}
)

target_link_libraries(pca595_core PUBLIC
    Threads::Threads
    CURL::libcurl
    nlohmann_json::nlohmann_json
)

target_compile_definitions(pca595_core PUBLIC
    $<$<BOOL:${PCA_USE_227F}>:PCA_USE_227F>
    $<$<BOOL:${PCA_USE_IIT_452}>:PCA_USE_IIT_452>
    $<$<BOOL:${PCA_USE_GRPC}>:PCA_USE_GRPC>
    $<$<BOOL:${PCA_USE_REAL_DRIVER}>:PCA_USE_REAL_DRIVER>
    $<$<BOOL:${PCA_BUILD_ASYNC}>:PCA_BUILD_ASYNC>
)

if(PCA_USE_GRPC)
    target_link_libraries(pca595_core PUBLIC gRPC::grpc++)
endif()

if(PCA_ENABLE_OPENGL)
    target_link_libraries(pca595_core PUBLIC OpenGL::GL)
    target_compile_definitions(pca595_core PUBLIC PCA_OPENGL_ENABLED)
endif()

if(PCA_USE_REAL_DRIVER)
    find_library(IRIS_DRIVER_LIB iris_network_driver
        PATHS ${IRIS_DRIVER_DIR}/lib
        NO_DEFAULT_PATH
    )
    if(IRIS_DRIVER_LIB)
        target_link_libraries(pca595_core PUBLIC ${IRIS_DRIVER_LIB})
        target_include_directories(pca595_core PUBLIC ${IRIS_DRIVER_DIR}/include)
    else()
        message(FATAL_ERROR "IRIS_DRIVER_LIB not found in ${IRIS_DRIVER_DIR}/lib")
    endif()
endif()

# --- Biblioteca PhiMonitor ---
if(PCA_BUILD_MONITOR)
    add_library(pca595_monitor STATIC
        PhiMonitor.cpp
    )
    target_link_libraries(pca595_monitor PUBLIC pca595_core)
endif()

# --- Testes ---
if(PCA_BUILD_TESTS)
    enable_testing()

    # Teste AlignmentClient
    add_executable(test_alignment_client test_alignment_client.cpp)
    target_link_libraries(test_alignment_client PRIVATE
        pca595_core
        GTest::gtest
        GTest::gmock
    )
    add_test(NAME AlignmentClientTest COMMAND test_alignment_client)

    # Teste PhiMeterIIT
    add_executable(test_phi_meter_iit test_phi_meter_iit.cpp)
    target_link_libraries(test_phi_meter_iit PRIVATE
        pca595_core
        GTest::gtest
        GTest::gmock
    )
    add_test(NAME PhiMeterIITTest COMMAND test_phi_meter_iit)

    # Teste Async OR
    if(PCA_BUILD_ASYNC)
        add_executable(test_async_or test_async_or.cpp)
        target_link_libraries(test_async_or PRIVATE
            pca595_core
            GTest::gtest
            GTest::gmock
        )
        add_test(NAME AsyncORTest COMMAND test_async_or)
    endif()
endif()

# --- Instalação ---
install(TARGETS pca595_core
    ARCHIVE DESTINATION lib
    LIBRARY DESTINATION lib
)

install(FILES
    PCA-595.h
    PhiMonitor.h
    AlignmentClient.h
    PhiMeterIIT.h
    ConsciousnessCycleAsync.h
    PCA-595-Integration.h
    DESTINATION include/arkhe/iris/pca
)