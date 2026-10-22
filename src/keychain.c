#include <Security/Security.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
// Credentials travel through stdin, never process arguments or a plaintext file.
int main(int argc, char **argv) {
 if(argc!=2) return 2;
 const void *keys[]={kSecClass,kSecAttrService,kSecAttrAccount};
 const void *vals[]={kSecClassGenericPassword,CFSTR("com.honeycyj.eagle-r2"),CFSTR("r2")};
 CFMutableDictionaryRef q=CFDictionaryCreateMutable(NULL,0,&kCFTypeDictionaryKeyCallBacks,&kCFTypeDictionaryValueCallBacks);
 for(int i=0;i<3;i++) CFDictionarySetValue(q,keys[i],vals[i]);
 OSStatus status=errSecParam;
 if(!strcmp(argv[1],"get")) {
  CFDictionarySetValue(q,kSecReturnData,kCFBooleanTrue);
  CFTypeRef result=NULL; status=SecItemCopyMatching(q,&result);
  if(status==errSecSuccess) { CFDataRef data=(CFDataRef)result; fwrite(CFDataGetBytePtr(data),1,CFDataGetLength(data),stdout); CFRelease(result); }
 } else if(!strcmp(argv[1],"set")) {
  unsigned char buf[8192]; size_t n=fread(buf,1,sizeof(buf),stdin);
  if(n==sizeof(buf)) return 3;
  CFDataRef data=CFDataCreate(NULL,buf,n);
  CFMutableDictionaryRef update=CFDictionaryCreateMutable(NULL,0,&kCFTypeDictionaryKeyCallBacks,&kCFTypeDictionaryValueCallBacks);
  CFDictionarySetValue(update,kSecValueData,data);
  status=SecItemUpdate(q,update);
  if(status==errSecItemNotFound) { CFDictionarySetValue(q,kSecValueData,data); status=SecItemAdd(q,NULL); }
  memset(buf,0,sizeof(buf)); CFRelease(update); CFRelease(data);
 } else if(!strcmp(argv[1],"delete")) { status=SecItemDelete(q); if(status==errSecItemNotFound) status=errSecSuccess; }
 CFRelease(q);
 if(status!=errSecSuccess) { fprintf(stderr,"Keychain status %d",(int)status); return 1; }
 return 0;
}
