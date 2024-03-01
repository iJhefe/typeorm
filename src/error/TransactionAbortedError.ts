import { TypeORMError } from "./TypeORMError"

export class TransactionAbortedError extends TypeORMError {
    constructor() {
        super("Transaction has been aborted by the user.")
    }
}
