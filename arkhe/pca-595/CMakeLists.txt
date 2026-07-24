# ============================================================================
# Adições ao CMakeLists.txt do PCA-595
# Arquiteto: ORCID 0009-0005-2697-4668
# Data: 2026-05-23
# ============================================================================

# --- Opções de build ---
option(PCA_USE_227F "Integrate with Constitutional Alignment Engine (227-F)" OFF)
option(PCA_USE_IIT_452 "Integrate with IIT Engine (452) for exact Phi computation" OFF)
option(PCA_USE_GRPC "Use gRPC for alignment service communication" OFF)
option(PCA_USE_REAL_DRIVER "Link against real IrisNetworkDriver" OFF)
option(PCA_BUILD_ASYNC "Build with C++20 async OR support" OFF)

# --- Dependências ---
find_package(CURL REQUIRED)
find_package(nlohmann_json REQUIRED)

if(PCA_USE_GRPC)
    find_package(gRPC REQUIRED)
endif()

if(PCA_BUILD_ASYNC)
    set(CMAKE_CXX_STANDARD 20)
endif()

# --- Biblioteca PCA-595 core (atualizada) ---
add_library(pca595_core STATIC
    PCA-595.cpp
    AlignmentClient.cpp      # NEW: v2.1
    PhiMeterIIT.cpp          # NEW: v2.1
)

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

# --- Testes ---
if(PCA_BUILD_TESTS)
    add_executable(test_alignment_client tests/test_alignment_client.cpp)
    target_link_libraries(test_alignment_client PRIVATE pca595_core)
    add_test(NAME AlignmentClientTest COMMAND test_alignment_client)

    add_executable(test_phi_meter_iit tests/test_phi_meter_iit.cpp)
    target_link_libraries(test_phi_meter_iit PRIVATE pca595_core)
    add_test(NAME PhiMeterIITTest COMMAND test_phi_meter_iit)
endif()
