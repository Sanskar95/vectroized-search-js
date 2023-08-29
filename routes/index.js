const express = require('express');

const router = express.Router();
const {Client} = require("@elastic/elasticsearch");
const natural = require('natural');
const fs = require('fs');
const PDFParser = require('pdf-parse');
const PDFJS = require("pdfjs-dist/legacy/build/pdf.js");
const axios = require("axios");

const TfIdf = natural.TfIdf;



const getEmbedding =(body)=>{
    let config = {
        headers: {
            'Authorization': 'Bearer ' + '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'
        }
    }
    return axios.post(
        'https://api.openai.com/v1/embeddings',body,
        config
    )
}



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

const pdfList = ["apple.pdf", "mongo.pdf","nvdia.pdf"]

const extractTextFromPdf = async (pdfFilePath) => {
    try {
        const pdfData = fs.readFileSync(pdfFilePath);

        const pdf = await PDFParser(pdfData);
        console.log(pdf.text)
        return pdf.text;
    } catch (error) {
        console.error('Error extracting text:', error);
        return null;
    }
};


async function getContent(src) {
    const doc = await PDFJS.getDocument(src).promise // note the use of the property promise
    const page = await doc.getPage(1)
    const content = await page.getTextContent()
    let stringDoc = ""
    for (let i =0; i<content.items.length ;i++){
        stringDoc=stringDoc.concat(" ")
        stringDoc=stringDoc.concat(content.items[i].str)
    }
  return stringDoc
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


const createIndices = async () => {
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
                        dims: 1536,
                        index: true,
                        // similarity: "cosine",
                    },
                },
            },
        },
    });
};

const createIndexs = () => {
    // // Get embeddings for documents
    let embeddingsPromiseArray = []
    for (let i = 0; i < documents.length; i++) {
        embeddingsPromiseArray.push(getEmbedding({
            input: documents[i],
            model: "text-embedding-ada-002"
        }))
    }


    Promise.all(embeddingsPromiseArray).then(embeddings=>{
        let embeddingsData = embeddings.map(embedding=> embedding.data.data[0].embedding)
        for(let i = 0; i<embeddingsData.length; i++){
            console.log(embeddingsData[i].length)
            client.index({
                // store document and embedding in Elasticsearch
                index: "texts",
                // type: 'document',
                // id: index,
                body: {
                    document: documents[i],
                    embedding: embeddingsData[i],
                },
            }).then(r => console.log("successfully inserted"))
        }
    })






    // documents.forEach((document) => {
    //     const embedding = createEmbeddings(document)
    //     client.index({
    //         // store document and embedding in Elasticsearch
    //         index: "texts",
    //         // type: 'document',
    //         // id: index,
    //         body: {
    //             document: document,
    //             embedding: embedding,
    //         },
    //     }).then(r => console.log("successfully inserted"))
    // });
};
const query = async (input) => {
    const query = await getEmbedding({
        input: input,
        model: "text-embedding-ada-002"
    })
    const query_embedding = query.data.data[0].embedding

    const response = await client.search({
        index: 'texts',
        body: {
            size: 3,
            query: {
                function_score: {
                    query: {
                        match_all: {}, // You can adjust this query to filter your documents
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
    await createIndices()
    createIndexs()
    res.render('index', {title: 'Express'});
});

router.get('/search', async function (req, res, next) {
    let queryString = req.query.search_string
    let hits = await query(queryString)
    res.send(hits)
});
module.exports = router;
