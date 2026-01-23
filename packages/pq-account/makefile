CORES := $(shell nproc)
install: 
	foundryup
	cd lib/ETHDILITHIUM/pythonref;make install
	cd lib/ETHFALCON/pythonref;make install
test_opt:
	forge test -j$(CORES) -vv
test_not_opt:
	FOUNDRY_PROFILE=lite forge test -j$(CORES) -vv
