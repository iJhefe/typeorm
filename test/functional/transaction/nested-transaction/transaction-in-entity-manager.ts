import "reflect-metadata"
import {
    closeTestingConnections,
    createTestingConnections,
    reloadTestingDatabases,
} from "../../../utils/test-utils"
import { DataSource } from "../../../../src/data-source/DataSource"
import { Post } from "./entity/Post"
import { expect } from "chai"
import { TransactionAbortedError } from "../../../../src/error/TransactionAbortedError"

describe("transaction > nested transaction", () => {
    let connections: DataSource[]
    before(
        async () =>
            (connections = await createTestingConnections({
                entities: [__dirname + "/entity/*{.js,.ts}"],
            })),
    )
    beforeEach(() => reloadTestingDatabases(connections))
    after(() => closeTestingConnections(connections))

    it("should execute operations based on conditions in deeply nested scenario", () =>
        Promise.all(
            connections.map(async (connection) => {
                const conditions: {
                    id: number
                    title: string
                    shouldExist: boolean
                }[] = []

                // Spanner does not support nested transactions
                if (connection.driver.options.type === "spanner") return

                await connection.manager.transaction(async (em0) => {
                    const post = new Post()
                    post.title = "Post #1"
                    await em0.save(post)
                    conditions.push({ ...post, shouldExist: true })

                    try {
                        await em0.transaction(async (em1) => {
                            const post = new Post()
                            post.title = "Post #2"
                            await em1.save(post)
                            conditions.push({ ...post, shouldExist: false })

                            await em1.transaction(async (em2) => {
                                const post = new Post()
                                post.title = "Post #3"
                                await em2.save(post)
                                conditions.push({ ...post, shouldExist: false })
                            })
                            throw new Error("")
                        })
                    } catch (_) {}

                    await em0.transaction(async (em1) => {
                        const post = new Post()
                        post.title = "Post #4"
                        await em1.save(post)
                        conditions.push({ ...post, shouldExist: true })
                    })

                    await em0.transaction(async (em1) => {
                        const post = new Post()
                        post.title = "Post #5"
                        await em1.save(post)
                        conditions.push({ ...post, shouldExist: true })

                        try {
                            await em1.transaction(async (em2) => {
                                const post = new Post()
                                post.title = "Post #6"
                                await em2.save(post)
                                conditions.push({ ...post, shouldExist: false })

                                await em2.transaction(async (em3) => {
                                    const post = new Post()
                                    post.title = "Post #7"
                                    await em3.save(post)
                                    conditions.push({
                                        ...post,
                                        shouldExist: false,
                                    })
                                })
                                throw new Error("")
                            })
                        } catch (_) {}

                        await em1.transaction(async (em2) => {
                            const post = new Post()
                            post.title = "Post #8"
                            await em2.save(post)
                            conditions.push({ ...post, shouldExist: true })
                        })

                        await em1.transaction(async (em2) => {
                            const post = new Post()
                            post.title = "Post #9"
                            await em2.save(post)
                            conditions.push({ ...post, shouldExist: true })

                            try {
                                await em2.transaction(async (em3) => {
                                    const post = new Post()
                                    post.title = "Post #10"
                                    await em3.save(post)
                                    conditions.push({
                                        ...post,
                                        shouldExist: false,
                                    })

                                    await em3.transaction(async (em4) => {
                                        const post = new Post()
                                        post.title = "Post #11"
                                        await em4.save(post)
                                        conditions.push({
                                            ...post,
                                            shouldExist: false,
                                        })
                                    })
                                    throw new Error("")
                                })
                            } catch (_) {}

                            await em2.transaction(async (em3) => {
                                const post = new Post()
                                post.title = "Post #12"
                                await em3.save(post)
                                conditions.push({ ...post, shouldExist: true })
                            })
                        })
                    })
                })

                for (const condition of conditions) {
                    const post = await connection.manager.findOne(Post, {
                        where: { title: condition.title },
                    })
                    if (condition.shouldExist) {
                        expect(post).not.to.be.null
                        post!.should.be.eql({
                            id: condition.id,
                            title: condition.title,
                        })
                    } else {
                        expect(post).to.be.null
                    }
                }
            }),
        ))

    it("should fail operations when first transaction fails", () =>
        Promise.all(
            connections.map(async (connection) => {
                const conditions: { id: number; title: string }[] = []

                try {
                    await connection.manager.transaction(async (em0) => {
                        const post = new Post()
                        post.title = "Post #1"
                        await em0.save(post)
                        conditions.push({ ...post })

                        try {
                            await em0.transaction(async (em1) => {
                                const post = new Post()
                                post.title = "Post #2"
                                await em1.save(post)
                                conditions.push({ ...post })
                                throw new Error("")
                            })
                        } catch (_) {}

                        await em0.transaction(async (em1) => {
                            const post = new Post()
                            post.title = "Post #3"
                            await em1.save(post)
                            conditions.push({ ...post })

                            try {
                                await em1.transaction(async (em2) => {
                                    const post = new Post()
                                    post.title = "Post #4"
                                    await em2.save(post)
                                    conditions.push({ ...post })
                                    throw new Error("")
                                })
                            } catch (_) {}

                            await em1.transaction(async (em2) => {
                                const post = new Post()
                                post.title = "Post #5"
                                await em2.save(post)
                                conditions.push({ ...post })

                                try {
                                    await em2.transaction(async (em3) => {
                                        const post = new Post()
                                        post.title = "Post #6"
                                        await em3.save(post)
                                        conditions.push({ ...post })
                                        throw new Error("")
                                    })
                                } catch (_) {}
                            })
                        })
                        throw new Error("")
                    })
                } catch (_) {}

                for (const condition of conditions) {
                    const post = await connection.manager.findOne(Post, {
                        where: { title: condition.title },
                    })
                    expect(post).to.be.null
                }
            }),
        ))

    it("should fail when signal is aborted in nested transaction", () =>
        Promise.all(
            connections.map(async (connection) => {
                const posts: { id: number; title: string }[] = []

                const controller = new AbortController()

                const sleep = (ms: number) =>
                    new Promise((resolve) => setTimeout(resolve, ms))

                setTimeout(() => controller.abort(), 500)

                try {
                    await connection.manager.transaction(async (em0) => {
                        const post = new Post()
                        post.title = "Post #1"
                        await em0.save(post)

                        posts.push({ ...post })

                        await em0.transaction(
                            { signal: controller.signal },
                            async (em1) => {
                                const post = new Post()
                                post.title = "Post #2"
                                await em1.save(post)

                                posts.push({ ...post })

                                await sleep(500)
                            },
                        )
                    })
                } catch (error) {
                    expect(error).to.be.instanceOf(TransactionAbortedError)
                }

                for (const post of posts) {
                    const foundPost = await connection.manager.findOne(Post, {
                        where: { title: post.title },
                    })

                    expect(foundPost).to.be.null
                }
            }),
        ))

    it("should fail when aborted signal is given in nested transaction", () =>
        Promise.all(
            connections.map(async (connection) => {
                const posts: { id: number; title: string }[] = []

                const controller = new AbortController()
                controller.abort()

                try {
                    await connection.manager.transaction(async (em0) => {
                        const post = new Post()
                        post.title = "Post #1"
                        await em0.save(post)

                        posts.push({ ...post })

                        await em0.transaction(
                            { signal: controller.signal },
                            async (em1) => {
                                const post = new Post()
                                post.title = "Post #2"
                                await em1.save(post)

                                posts.push({ ...post })
                            },
                        )
                    })
                } catch (error) {
                    expect(error).to.be.instanceOf(TransactionAbortedError)
                }

                for (const post of posts) {
                    const foundPost = await connection.manager.findOne(Post, {
                        where: { title: post.title },
                    })

                    expect(foundPost).to.be.null
                }
            }),
        ))

    it("should fail when signal of primary transaction is aborted even if nested transaction is finished", () =>
        Promise.all(
            connections.map(async (connection) => {
                const posts: { id: number; title: string }[] = []

                const controller = new AbortController()

                try {
                    await connection.manager.transaction(
                        { signal: controller.signal },
                        async (em0) => {
                            const post = new Post()
                            post.title = "Post #1"
                            await em0.save(post)

                            posts.push({ ...post })

                            await em0.transaction(async (em1) => {
                                const post = new Post()
                                post.title = "Post #2"
                                await em1.save(post)

                                posts.push({ ...post })
                            })

                            controller.abort()
                        },
                    )
                } catch (error) {
                    expect(error).to.be.instanceOf(TransactionAbortedError)
                }

                for (const post of posts) {
                    const foundPost = await connection.manager.findOne(Post, {
                        where: { title: post.title },
                    })

                    expect(foundPost).to.be.null
                }
            }),
        ))

    it("should save data of nested transaction when signal of nested transaction is aborted after nested transaction is finished", () =>
        Promise.all(
            connections.map(async (connection) => {
                let parentPost: Post | undefined
                let childPost: Post | undefined

                const controller = new AbortController()
                const sleep = (ms: number) =>
                    new Promise((resolve) => setTimeout(resolve, ms))

                setTimeout(() => controller.abort(), 500)

                try {
                    await connection.manager.transaction(async (em0) => {
                        const post = new Post()
                        post.title = "Post #1"
                        await em0.save(post)

                        parentPost = { ...post }

                        await em0.transaction(
                            { signal: controller.signal },
                            async (em1) => {
                                const post = new Post()
                                post.title = "Post #2"
                                await em1.save(post)

                                childPost = { ...post }
                            },
                        )

                        // wait timeout for call abort nested transaction
                        await sleep(500)
                    })
                } catch (error) {
                    expect(error).to.be.instanceOf(TransactionAbortedError)
                }

                const foundParentPost = await connection.manager.findOne(Post, {
                    where: { title: parentPost!.title },
                })

                const foundChildPost = await connection.manager.findOne(Post, {
                    where: { title: childPost!.title },
                })

                expect(foundParentPost).to.be.eql(parentPost)

                expect(foundChildPost).to.be.eql(childPost)
            }),
        ))
})
