CORES := $(shell nproc)
install: 
	foundryup
	forge install ZKNOXHQ/ETHDILITHIUM
	forge install eth-infinitism/account-abstraction
	forge install OpenZeppelin/openzeppelin-contracts
	cd lib/ETHDILITHIUM/pythonref;make install
test_opt:
	forge test -j$(CORES) -vv
test_not_opt:
	FOUNDRY_PROFILE=lite forge test -j$(CORES) -vv
