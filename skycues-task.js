// // localhost
// const apikey = "crVBTYNUIyntybrvtercsGYTHUYHrtefrYGeBTRHEYRTgy7hRHTGDY";
// const server = "http://localhost/v1";

// skycues.com
const apikey = "DbKNN9L9YAGxc5g4BLUseR2QjCPUErWu1MitaAHEOC9Wegd9CeHnRd";
const server = "https://skycues.com/v1";

const https = require('https');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
let jobid; 

// node skycues-task.js --input <image or geojson file or directory> --output <output file or directory> --date <yyyy-mm-dd> --nirband <yes|no> --clouds <0-100> --mode <details|textures> --bands <bands comma separated> 
// node skycues-task.js --input D:/Desktop/skycues-sample/test-api-image.tiff --output out --mode details --date 2022-07-15 --clouds 30 --nirband yes --s2bands B2,B4,B8

const args = process.argv.slice(2).join(" ");
const params = args.split("--");

let pathtoupload, output, isFile, date, nirband, clouds, mode, mergetiles, georeference, s2bands;
// pathtoupload = "D:/Desktop/skycues-sample/small-test.jpeg" 
// output = "out" 
// date = "2015-10-10"
// mode = "details"

for (let index = 0; index < params.length; index++) {
    const param = params[index];
    const paramname = param.split(" ")[0];
    const paramvalue = param.split(" ").slice(1).join(" ");

    if (paramname == "input") {
        pathtoupload = paramvalue.trim();
    }
    if (paramname == "output") {
        output = paramvalue.trim();
    }
    if (paramname == "date") {
        date = new Date(paramvalue.trim()).toISOString().split("T")[0];
    }
    if (paramname == "nirband") {
        nirband = paramvalue.trim().toLocaleLowerCase() == 'no' ? "false" : "true";
    }
    if (paramname == "clouds") {
        clouds = paramvalue.trim();
    }
    if (paramname == "mode") {
        mode = paramvalue.trim();
    }
    if (paramname == "mergetiles") {
        mergetiles = paramvalue.trim().toLocaleLowerCase() == 'no' ? "false" : "true";;
    }
    if (paramname == "georeference") {
        georeference = paramvalue.trim().toLocaleLowerCase() == 'no' ? "false" : "true";;
    }
    if (paramname == "s2bands") {
        s2bands = paramvalue.trim().toUpperCase();
    }
}

// At instance level
const instance = axios.create({
    httpsAgent: new https.Agent({  
        rejectUnauthorized: false
    })
});

async function checkRequest(method, url, data) {
    try {
        let retValue;
        if (method == "get") {
            retValue = (await instance.get(url)).data;
        }
        if (method == "post") {
            retValue = (await instance.post(url, data)).data;    
        }
        
        return retValue;
    }
    catch(e) {
        console.log("Request FAIL", e.message);
    }
}

async function uploadFile (filetoupload) {
    console.log("File to upload: ", filetoupload);
    const sourcefileextension = filetoupload.split(".").slice(-1)[0];
    const outputfileextension = ["geojson","tif","tiff"].includes(sourcefileextension.toLowerCase()) ? "tif" : "png";
    /********************************************/
    /*************** UPLOAD IMAGE ***************/
    /********************************************/
    try {
        const formData = new FormData();
        formData.append('apikey', apikey);
        const img = fs.createReadStream(filetoupload);
        formData.append('image', img);

        if (date != undefined) {
            formData.append('s2date', date);
        }
        if (nirband != undefined) {
            formData.append('nir_band', nirband);
        }
        if (clouds != undefined) {
            formData.append('clouds', clouds);
        }
        if (mergetiles != undefined) {
            formData.append('merge_tiles', mergetiles);
        }
        if (georeference != undefined) {
            formData.append('geo_reference', georeference);
        }
        if (s2bands != undefined) {
            formData.append('s2bands', s2bands);
        }
        
        let pmode = ""
        if (mode == "textures") {
            pmode = "v0";
        }
        if (mode == "details") {
            pmode = "v1";
        }
        if (mode == "1m") {
            pmode = "v2";
        }
        formData.append('mode', pmode);

        const uploadresponse = (await instance.post(server+'/order', formData, {
            headers: formData.getHeaders()
        })).data;

        jobid = uploadresponse.jobid;
        console.log("Job Id: ", filetoupload, jobid);

        if (jobid == undefined) {
            console.log("upload image", "FAILED to create a job");
            return;
        }
        console.log("upload image", "Image uploaded sucessfully with jobId", jobid);
    }
    catch(e) {
        console.log("upload image", "FAILED to create a job", e.message);
    }

    /*********************************************/
    /*************** CHECK CREDITS ***************/
    /*********************************************/
    const creditResponse = await checkRequest("post", server+"/check-credit", {"apikey":apikey});
    console.log(creditResponse, "credits response");    

    /*********************************************/
    /**************** CHECK ORDER ****************/
    /*********************************************/
    const checkOrderResponse = await checkRequest("post", server+"/check-order", {"apikey":apikey, "jobid":jobid});
    if (checkOrderResponse.ETA == undefined) {
        console.log("Error obtaining the order ETA");
        return;
    }
    console.log("Time remaining:", checkOrderResponse.ETA);

    // Repeat wait until secondsRemaining are zero
    async function waitUntilOrdenDone() {
        async function wait(resolve) {
            const response = await checkRequest("post", server+"/check-order", {"apikey":apikey, "jobid":jobid});
            console.log("response", response)
            if (response.secondsRemaining == 0) {
                resolve(true);
            }
            else {
                setTimeout(() => {
                    wait(resolve);
                }, response.secondsRemaining*1000);
            }
        }

        return new Promise(async (resolve, reject) => {
            await wait(resolve);
        });
    }
    
    await waitUntilOrdenDone();

    /*********************************************/
    /************** DOWNLOAD RESULT **************/
    /*********************************************/
    async function downloadImage () {  
        const url = server+"/get-order/"+jobid;
        let writer;
        if (isFile) {
            output = output || filetoupload.split("/").slice([-1])[0].split(".").slice(0,-1).join(".");
            writer = fs.createWriteStream(`SR-${output}.${outputfileextension}`);
        }
        else {
            writer = fs.createWriteStream(`${output}/SR-${filetoupload.split("/").slice([-1])[0].split(".").slice(0,-1).join(".")}.${outputfileextension}`);
        }
      
        const response = await instance({
            url,
            method: 'GET',
            responseType: 'stream'
        });
      
        response.data.pipe(writer);
      
        return new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
    }
    downloadImage();
}

async function main() {
    if (output == undefined) {
        console.log("Missing output parameter");
        return;
    }

    isFile = fs.lstatSync(pathtoupload).isFile();
    if (isFile) {
        await uploadFile(pathtoupload);
    }
    else {
        // Is Directory
        if (!fs.existsSync("./"+output)){
            fs.mkdirSync("./"+output);
        }
        
        for (const filetoupload of fs.readdirSync(pathtoupload)) {
            await uploadFile(`${pathtoupload}/${filetoupload}`);
        }
    }
}

main();