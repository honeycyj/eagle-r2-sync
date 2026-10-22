'use strict';
const fs = require('fs');
const crypto = require('crypto');
const images = {jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',bmp:'image/bmp'};
const videos = {mp4:'video/mp4',m4v:'video/mp4',mov:'video/quicktime',webm:'video/webm',mkv:'video/x-matroska',avi:'video/x-msvideo',mpeg:'video/mpeg',mpg:'video/mpeg','3gp':'video/3gpp',ogv:'video/ogg',ts:'video/mp2t',mts:'video/mp2t',m2ts:'video/mp2t',wmv:'video/x-ms-wmv',flv:'video/x-flv'};
const MAX_IMAGE_BYTES = 80 * 1024 * 1024;
const MAX_VIDEO_BYTES = 5 * 1024 * 1024 * 1024;
function type(ext) {
 ext=String(ext).toLowerCase();
 return images[ext]?{kind:'image',ext,mime:images[ext]}:videos[ext]?{kind:'video',ext,mime:videos[ext]}:null;
}
function identity(stat) { return [stat.size,stat.mtimeMs,stat.ctimeMs,stat.ino].join(':'); }
async function hashFile(file) {
 const sha=crypto.createHash('sha256'),md5=crypto.createHash('md5');
 for await(const chunk of fs.createReadStream(file)) {sha.update(chunk);md5.update(chunk);}
 return {sha256:sha.digest('hex'),md5:md5.digest('hex')};
}
module.exports={images,videos,type,identity,hashFile,MAX_IMAGE_BYTES,MAX_VIDEO_BYTES};
