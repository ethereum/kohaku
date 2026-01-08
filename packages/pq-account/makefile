CORES := $(shell nproc)
install: 
	foundryup
	forge install ZKNOXHQ/ETHDILITHIUM
	forge install ZKNOXHQ/ETHFALCON
	forge install ZKNOXHQ/InterfaceVerifier
	forge install eth-infinitism/account-abstraction@v0.8.0
	forge install OpenZeppelin/openzeppelin-contracts
	cd lib/ETHDILITHIUM/pythonref;make install
	cd lib/ETHFALCON/pythonref;make install
test_opt:
	forge test -j$(CORES) -vv
test_not_opt:
	FOUNDRY_PROFILE=lite forge test -j$(CORES) -vv
