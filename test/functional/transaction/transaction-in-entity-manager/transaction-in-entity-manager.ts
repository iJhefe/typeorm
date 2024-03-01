import "reflect-metadata"
import {
    closeTestingConnections,
    createTestingConnections,
    reloadTestingDatabases,
} from "../../../utils/test-utils"
import { DataSource } from "../../../../src/data-source/DataSource"
import { Post } from "./entity/Post"
import { Category } from "./entity/Category"
import { expect } from "chai"
import { TransactionAbortedError } from "../../../../src/error/TransactionAbortedError"

describe("transaction > transaction with entity manager", () => {
    let connections: DataSource[]
    before(
        async () =>
            (connections = await createTestingConnections({
                entities: [__dirname + "/entity/*{.js,.ts}"],
                enabledDrivers: [
                    "mysql",
                    "sqlite",
                    "better-sqlite3",
                    "postgres",
                ], // todo: for some reasons mariadb tests are not passing here
            })),
    )
    beforeEach(() => reloadTestingDatabases(connections))
    after(() => closeTestingConnections(connections))

    it("should execute all operations in a single transaction", () =>
        Promise.all(
            connections.map(async (connection) => {
                let postId: number | undefined = undefined,
                    categoryId: number | undefined = undefined

                await connection.manager.transaction(async (entityManager) => {
                    const post = new Post()
                    post.title = "Post #1"
                    await entityManager.save(post)

                    const category = new Category()
                    category.name = "Category #1"
                    await entityManager.save(category)

                    postId = post.id
                    categoryId = category.id
                })

                const post = await connection.manager.findOne(Post, {
                    where: { title: "Post #1" },
                })
                expect(post).not.to.be.null
                post!.should.be.eql({
                    id: postId,
                    title: "Post #1",
                })

                const category = await connection.manager.findOne(Category, {
                    where: { name: "Category #1" },
                })
                expect(category).not.to.be.null
                category!.should.be.eql({
                    id: categoryId,
                    name: "Category #1",
                })
            }),
        ))

    it("should not save anything if any of operation in transaction fail", () =>
        Promise.all(
            connections.map(async (connection) => {
                let postId: number | undefined = undefined,
                    categoryId: number | undefined = undefined

                try {
                    await connection.manager.transaction(
                        async (entityManager) => {
                            const post = new Post()
                            post.title = "Post #1"
                            await entityManager.save(post)

                            const category = new Category()
                            category.name = "Category #1"
                            await entityManager.save(category)

                            postId = post.id
                            categoryId = category.id

                            const loadedPost = await entityManager.findOne(
                                Post,
                                { where: { title: "Post #1" } },
                            )
                            expect(loadedPost).not.to.be.null
                            loadedPost!.should.be.eql({
                                id: postId,
                                title: "Post #1",
                            })

                            const loadedCategory = await entityManager.findOne(
                                Category,
                                { where: { name: "Category #1" } },
                            )
                            expect(loadedCategory).not.to.be.null
                            loadedCategory!.should.be.eql({
                                id: categoryId,
                                name: "Category #1",
                            })

                            // now try to save post without title - it will fail and transaction will be reverted
                            const wrongPost = new Post()
                            await entityManager.save(wrongPost)
                        },
                    )
                } catch (err) {
                    /* skip error */
                }

                const post = await connection.manager.findOne(Post, {
                    where: { title: "Post #1" },
                })
                expect(post).to.be.null

                const category = await connection.manager.findOne(Category, {
                    where: { name: "Category #1" },
                })
                expect(category).to.be.null
            }),
        ))

    it("should fail when signal is aborted", () =>
        Promise.all(
            connections.map(async (connection) => {
                const posts: { id: number; title: string }[] = []

                const controller = new AbortController()
                const sleep = (ms: number) =>
                    new Promise((resolve) => setTimeout(resolve, ms))

                setTimeout(() => controller.abort(), 500)

                try {
                    await connection.manager.transaction(
                        { signal: controller.signal },
                        async (em0) => {
                            const post = new Post()
                            post.title = "Post #1"
                            await em0.save(post)

                            posts.push({ ...post })

                            await sleep(500)
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

    it("should fail when aborted signal is given", () =>
        Promise.all(
            connections.map(async (connection) => {
                const posts: { id: number; title: string }[] = []

                const controller = new AbortController()
                controller.abort()

                try {
                    await connection.manager.transaction(
                        { signal: controller.signal },
                        async (em0) => {
                            const post = new Post()
                            post.title = "Post #1"
                            await em0.save(post)

                            posts.push({ ...post })
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
})
