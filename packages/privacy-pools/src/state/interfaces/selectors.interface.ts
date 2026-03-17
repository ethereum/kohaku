import { ISecretManager } from "../../account/keys";
import { IDataService } from "../../data/interfaces/data.service.interface";

export interface BaseSelectorParams {
  secretManager: ISecretManager;
  dataService: IDataService;
}
