const express = require('express');

const router = express.Router();
const {Client} = require("@elastic/elasticsearch");
const natural = require('natural');
const fs = require('fs');
const PDFParser = require('pdf-parse');
const PDFJS = require("pdfjs-dist/legacy/build/pdf");

const TfIdf = natural.TfIdf;


const client = new Client({
    node: "http://localhost:9200",
    auth: {
        username: "elastic",
        password: "changeme",
    },
});
// Test the connection
client.ping((err, res) => {
    if (err) {
        console.error("Connection failed:", err);
    } else {
        console.log("Connection successful:", res);
    }
}).then(r => console.log("Connection successful:"));


const documents = [];

const tfidf = new TfIdf();

// Step 2: Tokenize and add documents to the TF-IDF instance

const pdfList = ["p1.pdf", "p2.pdf", "p3.pdf", "p4.pdf", "p5.pdf"]
async function getContent(src) {
    const doc = await PDFJS.getDocument(src).promise // note the use of the property promise
    const page = await doc.getPage(1)
    const content = await page.getTextContent()
    return content.items.map((item) => item.str)[0]
}

pdfList.forEach(pdf => {
    getContent(pdf).then(text => {
        documents.push(text)
        console.log(text)
        tfidf.addDocument(text);
    })
})
const createEmbeddings = (document) => {
    const vector = [];
    tfidf.tfidfs(document, (i, measure) => {
        vector[i] = measure;
    });
    return vector
};
const createIndex = async () => {
    await client.indices.create({
        index: "texts",
        body: {
            mappings: {
                properties: {
                    // The document field stores the text of the animal
                    document: {
                        type: "text",
                    },
                    // The embedding field stores the vector representation of the animal
                    embedding: {
                        type: "dense_vector",
                        dims: pdfList.length,
                        index: true,
                        similarity: "cosine",
                    },
                },
            },
        },
    });
};

const populateIndexes = () => {
    // // Get embeddings for documents
    documents.forEach((document) => {
        const embedding = createEmbeddings(document)
        client.index({
            // store document and embedding in Elasticsearch
            index: "texts",
            // type: 'document',
            // id: index,
            body: {
                document: document,
                embedding: embedding,
            },
        }).then(r => console.log("successfully inserted"))
    });
};
const query = async (input) => {
    const query = input
    const query_embedding = createEmbeddings(input)


    const response = await client.search({
        index: 'pets',
        body: {
            size: 2,
            query: {
                function_score: {
                    query: {
                        match_all: {},
                    },
                    functions: [
                        {
                            script_score: {
                                script: {
                                    source: 'cosineSimilarity(params.queryEmbedding, "embedding") + 1.0',
                                    lang: 'painless',
                                    params: {
                                        queryEmbedding: query_embedding,
                                    },
                                },
                            },
                        },
                    ],
                },
            },
        },
    });


    return response.hits.hits
};
/* GET home page. */
router.get('/', function (req, res, next) {
    res.render('index', {title: 'Express'});
});

router.get('/create-indexes', async function (req, res, next) {
    await createIndex()
    populateIndexes()
    res.render('index', {title: 'Express'});
});

router.get('/search', async function (req, res, next) {
    let queryString = req.query.search_string
    let hits = await query(queryString)
    res.send(hits)
});
module.exports = router;
