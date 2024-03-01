import { IsolationLevel } from "./IsolationLevel"

export interface TransactionOptions {
    signal?: AbortSignal

    isolation?: IsolationLevel
}
