CORES := $(shell nproc)
install: 
	foundryup
	git submodule update --init --recursive
	if [ -d lib/ETHDILITHIUM/pythonref ]; then cd lib/ETHDILITHIUM/pythonref && make install; fi
	if [ -d lib/ETHFALCON/pythonref ]; then cd lib/ETHFALCON/pythonref && make install; fi
test_opt:
	forge test -j$(CORES) -vv
test_not_opt:
	FOUNDRY_PROFILE=lite forge test -j$(CORES) -vv
