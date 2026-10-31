# Traceability Firewall

Lokální MVP řízené kontroly. Node.js 22+ a SQLite; nejde zatím o víceuživatelský SaaS s izolací firem.

Aktuální vývojové závislosti pro DOM testy vyžadují Node.js 22.22.2+, 24.15+ nebo 26+. Ověřeno na Node.js 24.20.0.

## Spuštění

1. `npm.cmd install` (Windows PowerShell).
2. V `.env` nastavte `ADMIN_KEY` na náhodný klíč alespoň 32 znaků. Generování: `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
3. `npm.cmd start`, poté otevřete `http://localhost:3000`.
4. Administrace → vložte klíč → Vytvořit zákazníka → vyplňte projekt a jeho kroky → uložte → zveřejněte.
5. Operátor → vyberte projekt → načtěte průkaz, box a paletu → připravte pracoviště → skenujte díl.

## Pravidla kontroly

### Box, režim zadání a průběh

Před zahájením pracoviště zadejte číslo boxu, paletu a počet dílů (1–10 000). U každého je nabídka Skenovat / Ručně; v ručním režimu jsou ovladače fotoaparátu skryté. Počet lze naskenovat jako kladné celé číslo. Potvrzení pracoviště je samostatné. Identifikátory boxu/palety mohou být i číselné, například `1`; řídicí význam NOK platí až v kontrolním poli.

Kapacita v `wf_boxes` patří ke kombinaci projekt + paleta + box, nikoli operátorovi. Při opětovném otevření musí počet odpovídat uloženému. Kapacitu nelze přes tento formulář přepsat; pro opravu bude potřeba samostatná administrátorská změna. Počet nesmí být nižší než počet existujících dílů.

Ukazatel v hlavní obrazovce i kontrolním dialogu počítá unikátní dokončené kontroly OK + NOK. REWORK a rozpracované kontroly se do dokončených nepočítají. Každý založený díl rezervuje místo v boxu. Při dosažení kapacity nelze založit nový kus; stávající lze dokončit nebo znovu načíst. Opakovaný sken či síťové opakování nepřičítají kus navíc. Nejde o skladový výdej ani fyzický zůstatek materiálu.

Přes Zobrazit seznam dílů a výsledků otevřete přehled boxu s identifikátorem, stavem a operátorem, po 50 řádcích. Stav se aktualizuje při vlastní kontrole a otevření seznamu; pro změny z jiného zařízení použijte Obnovit. Starší API kontroly bez nastaveného boxu zůstává kompatibilní bez kapacitního omezení. Nové mobilní pracoviště vždy používá nastavení boxu.

### Když nejde aplikaci spustit

- `EADDRINUSE`: port už používá jiný server. Otevřete `http://localhost:3000`; pokud tam aplikace běží, další instanci nepotřebujete. Po úpravách kódu původní server zastavte pomocí Ctrl+C v jeho terminálu a znovu spusťte `npm.cmd start`. Pokud port patří jiné aplikaci, změňte `PORT` v `.env`.
- PowerShell hlásí zakázané `npm.ps1`: použijte `npm.cmd start` nebo `node server.js`. Není potřeba měnit systémové zásady PowerShellu.
- Soubor `database.js` pouze připravuje databázi. Webovou aplikaci spouští `server.js`.

- Každý projekt obsahuje 1–100 kroků. Uložený postup je neměnný. Tlačítko Nová revize / kopie otevře editor s původními kroky a přílohami; uložení vytvoří nový projekt a neovlivní staré kontroly.
- Vizuální úkon operátor potvrdí řídicím QR `0` (OK); nadále funguje i QR stejného dílu. Sken není automatické vyhodnocení fotografie.
- U kódů se ověřuje QR dílu, přesná shoda, nebo pouze přítomnost neprázdného kódu. Externí čtečka funguje jako klávesnice a ukončuje kód Enterem. Pole operátora, boxu, palety, dílu a kontrolního skenu mají také tlačítko Fotoaparát.

### Mobilní fotoaparát

Fotografie QR se čtou nejprve dekodérem jsQR: celá fotografie ve dvou měřítkách, středové a překrývající se rohové výřezy, včetně obráceného kontrastu. Pokud se QR nenajde, použije se ZXing i pro čárové kódy. Rozmazaný, přesvětlený nebo zakrytý QR nelze spolehlivě obnovit. Testy ověřují dodaný NOK QR a syntetický větší snímek s otočením a sníženým kontrastem; nenahrazují test skutečné mobilní fotografie.

Pro iPhone je u každého pole také samostatný viditelný nativní vstup **Vyfotit kód (iPhone)**. Klepněte na jeho tlačítko **Vybrat soubor** a případně zvolte **Pořídit fotografii**. Tento vstup neotevírá webový dialog před fotoaparátem a nepoužívá programové kliknutí; dialog rozpoznávání se zobrazí až po návratu se snímkem.

Připojte mobil na stejnou Wi-Fi a otevřete adresu počítače s portem 3000. Tlačítko Fotoaparát u příslušného pole na HTTPS/localhost spustí zadní kameru; v dialogu je i možnost pořídit/vybrat fotografii. Na HTTP adrese v místní síti otevřete dialog a potom přímo klepněte na Vyfotit / vybrat fotografii. Tento ovladač je skutečný nativní vstup pro soubor, aby Safari nemuselo otevírat skrytý vstup programovým kliknutím. Zda se otevře přímo kamera nebo nabídka souborů, závisí na mobilním prohlížeči. Živá kamera potřebuje zabezpečený kontext.

Dekódování QR i běžných čárových kódů probíhá lokálně přes ZXing; fotografie se neposílají na server a neukládají se. Do serveru se odešle pouze přečtený text v rámci běžné kontroly. Box, paleta a průkaz operátora se pouze vyplní; díl a kontrolní krok po úspěšném skenu pokračují stejným formulářem jako Enter. Jeden otevřený skener přijme pouze jeden výsledek. Při zavření dialogu nebo odchodu ze stránky se kamera zastaví. Soubor má limit 12 MB a rozlišení 32 megapixelů; nečitelnou nebo nepodporovanou fotografii lze vyfotit znovu. Doporučeno JPEG/PNG a jeden ostrý kód na snímku. Měření zůstává číselným vstupem.
- První NOK vyžádá opakovanou kontrolu stejného kroku. Druhý NOK uzavře díl. Nesprávný kód se započítá jako NOK.
- REWORK je dostupný, pouze pokud administrátor zadá pokyn k opravě. Dokončení opravy se potvrzuje QR `0` (nebo QR dílu) a vždy následuje nová kontrola stejného kroku. Oprava nemaže předchozí NOK na daném kroku; úspěšný krok počítadlo resetuje.
- Stav OK vznikne až po úspěchu všech kroků. Uzavřený díl se automaticky znovu neotevře.
- Stejné QR je unikátní v rámci projektu. Pokud kód označuje celou šarži namísto jednotlivého dílu, je před nasazením nutné doplnit samostatný identifikátor kusu.
- Výpadek spojení umožňuje opakovat tentýž požadavek. ID požadavku zabraňuje dvojímu zápisu. Verze kontroly brání souběžnému přeskočení kroku. Tlačítko načtení stavu obnoví kontrolu ze serveru.
- PNG/JPEG a PDF výkresy do 4 MB se ukládají do SQLite; probíhá kontrola typu a signatury, nikoli plné dekódování nebo antivirová kontrola. PDF se otevírá v samostatné kartě.
- Detail projektu obsahuje Mimořádný export CSV a Excel: data a graf. Původní API report a CSV export zůstávají pro původní matici 30 bodů.

## Nová administrace

Firmy jsou rozbalovací složky; pod nimi jsou odsazené projekty s výběrem, exportem a tlačítkem Smazat projekt. Firma má Smazat firmu. Před přesunem do Koše se zobrazuje potvrzení. Koš je vratný: data, kontrolní kroky, přílohy, výsledky i exporty zůstávají zachované. Smazání firmy přesune do Koše všechny její aktivní projekty v jediné transakci. Obnovení firmy vrátí pouze projekty smazané společně s ní; dříve samostatně smazané projekty zůstanou v Koši. Projekt nelze samostatně obnovit pod smazanou firmou. Trvalé mazání není implementováno.

Projekty v Koši nejsou v nabídce operátorů a nelze pro ně zahájit kontrolu nového dílu. Již založené kontroly je možné dokončit nebo obnovit podle jejich původního QR a údajů pracoviště. Admin může dál stáhnout export projektu z Koše. Kódy firem zůstávají rezervované i po přesunu do Koše.

Levý panel obsahuje zákazníky, vyhledávání a jejich projekty. Vpravo je editor zákazníka, základních údajů projektu nebo detail projektu. Kroky mají název vady, popis, fotografii/výkres, typ ověření a volitelný pokyn REWORK. Kroky lze přidávat, odebírat a měnit jejich pořadí. Staré projekty jsou v kategorii bez zákazníka a zůstávají použitelné.

Typ ověření: vizuální, QR, čárový kód nebo měření. U QR/čárového kódu je možná přesná shoda, přítomnost nebo shoda s identifikátorem dílu. Čtečka předává text; samotnou symbologii QR versus čárový kód server bez metadata čtečky neověří. Měření má dolní/horní mez včetně a jednotku. Nula a záporná čísla jsou povolena, pokud odpovídají toleranci. Prázdná hodnota není nula. Měření nelze nahradit QR OK.

Exporty jsou chráněné administrátorským klíčem a vždy se týkají vybraného projektu. Jeden řádek představuje pokus kontrolního kroku, včetně palety, boxu, dílu, příznaků OK/NOK/Rework a hodnoty měření. Potvrzení opravy má vlastní výsledek REWORK_DONE. Díl bez pokusů má řádek BEZ POKUSU a nesmí být automaticky považován za NOK. Graf počítá každý díl jednou podle aktuálního stavu (OK, NOK, REWORK, rozpracováno); nesčítá řádky pokusů. CSV má UTF-8 BOM a středníky. Excel má listy Data a Graf; graf je vložený PNG snímek, po změnách vyžaduje nový export. CSV nemá listy ani graf.

Export má limit 100 000 řádků a je sestavován v paměti. Při překročení vrátí chybu 413, nikdy neusekne data potichu. Pro větší objemy je nutné doplnit dávkový export. Přílohy nahrané před neúspěšným uložením projektu mohou zůstat nepřiřazené.

Skutečný stack tohoto adresáře je Express/JavaScript/SQLite. Next.js, TypeScript, PostgreSQL ani Prisma zde nejsou; úprava neprovádí migraci stacku. Kontrola syntaxe JavaScriptu a integrační testy nenahrazují TypeScript typecheck. Skladové odběry a zůstatky projekt neeviduje, takže částečný odběr a záporný zůstatek skladu nelze ověřit bez doplnění pravidel a modelu. Testuje se částečně dokončená kontrola a záporná naměřená hodnota.

## Ověření

### Dodané řídicí QR

Referenční katalog je v SQLite v tabulkách `wf_scan_codes` (6 přesných variant obsahu) a `wf_scan_reference_images` (7 původních PNG, SHA-256 a 9 dekódovaných referencí včetně trojitého listu). Při startu se bezpečně a opakovatelně naplní z `resources/scan-codes/manifest.json`. Obrázky se ověřují kontrolním součtem; katalog je referencí dekódovaného obsahu, nikoli vizuálním odhadem výsledku. Nový import původních souborů: `node scripts/import-scan-references.js cesta-ke-slozce`. Import ověří dekódování před zápisem manifestu.

V operátorském rozhraní otevřete **Ověřit mobil / externí čtečku bez zápisu kontroly**. Zde lze stejným polem ověřit mobil i USB/Bluetooth HID čtečku, zobrazit skutečný obsah, HEX a shodu s katalogem. Test nic nezapisuje do výsledků dílů. CR, LF a CRLF se odstraňují pouze na konci; velikost písmen se nemění a podobné texty se neodhadují. Kamera zachovává původní dekódovaný obsah v diagnostice i při odeslání kontrolního kroku. Samotná systémová klávesová událost Enter se do textového pole neukládá, proto její bajt HID čtečky nelze z DOM zpětně zjistit.

Fotografie s více různými rozpoznanými QR vyvolá chybu a nic neodešle; na snímku má být jediný povel. Nejde o záruku rozpoznání všech zakrytých nebo nečitelných kódů. Řídicí hodnoty `0`, `1`, `R` nejsou identifikátory operátora ani dílu. V poli boxu a palety se obsah chápe jako identifikátor; v poli kontrolního kroku jako povel. Počet dílů je kladné celé číslo.

### Doporučený pracovní proces

1. Před směnou v diagnostice ověřit OK, NOK a REWORK a čtečku nastavit na suffix Enter. Fotografovat každý QR zvlášť.
2. Zvolit projekt a načíst průkaz operátora, box a paletu. Mobilní sken tyto údaje pouze vyplní; po kontrole potvrdit pracoviště.
3. Načíst identifikátor dílu; tím otevřít jediný aktuální krok. Sken musí směřovat do viditelného pole, aplikace nezachytává globálně text zadávaný administrátorem.
4. Vizuální kontrola: `0` pokračuje, `1` žádá opakované ověření a druhý NOK ukončí díl, `R` otevře povolenou opravu. Potvrzení opravy nevynechá kontrolu stejného kroku.
5. Krok pro konkrétní kód nebo měření nelze obejít řídicím OK. Vyžaduje svůj datový sken nebo skutečnou hodnotu.
6. Po každém zápisu čekat na odpověď serveru. Při výpadku použít opakování stejného požadavku, ne znovu naslepo hodnotit díl. Po dokončení systém vrátí fokus na další kus.

Lokální dekódování všech sedmi PNG potvrdilo:

| Obrázek | Obsah | Význam |
| --- | --- | --- |
| QR_OK_dil.png | `0` | OK vizuálního kroku / dokončení opravy |
| QR_NOK_dil.png | `1` | NOK aktuálního kroku |
| QR_Rework.png | `R` | Zahájit opravu aktuálního kroku |
| QR_OK_ENTER.png | `0\r` | OK + CR (bajt 13) |
| QR_NOK_ENTER.png | `1\r` | NOK + CR (bajt 13) |
| QR_REWORK_ENTER.png | `R\r` | REWORK + CR (bajt 13) |
| QR_excel_3_kody.png | `0`, `1`, `R` | Tři stejné povely |

Obsah lze znovu ověřit příkazem `node scripts/decode-qr.js cesta.png`. Knihovna `jsqr` je vývojová závislost, `pngjs` se používá také při exportu grafu.

Řídicí QR se vyhodnocují na serveru. `0` nikdy nenahrazuje sken vyžadovaný krokem typu `scan`, ani kontrolu přítomnosti. `1` započítá NOK; `R` zahájí opravu, pokud je povolena. Ve stavu REWORK `0` pouze potvrdí opravu, neposune na další krok. Historie zachovává přijatý obsah skenu a vrací `excel_code` (`0`, `1`, `R`; u potvrzení opravy `null`). Nejde ještě o nový CSV export.

Kódy `0`, `1`, `R` jsou vyhrazené a nelze je použít jako ID nového dílu nebo očekávanou přesnou hodnotu nového kroku. Již existující projekty s těmito hodnotami je nutné před použitím upravit novou revizí. Příkazy rozlišují velikost písmen; `r` není REWORK.

Formulář se odešle Enterem. U variant bez vloženého CR nastavte suffix Enter na čtečce, případně stiskněte Enter / tlačítko OVĚŘIT SKEN. Prázdný druhý Enter nic neodesílá; během požadavku je vstup blokován. Automatické odesílání samotného znaku `1` nepoužíváme, protože by mohlo přerušit běžný kód začínající číslicí 1. Fyzické chování CR závisí na konfiguraci čtečky a je nutné ověřit na pracovišti.

`npm.cmd test` ověří na oddělených dočasných databázích migraci, zákazníky, projekty, přístup administrátora, publikování, měření, CSV/Excel exporty, OK/NOK, REWORK, opakování požadavku, souběh, rollback, přílohy a report. Neověřuje skutečnou čtečku ani ovládání na tabletu.

## Zbývající rozsah SaaS

Sdílený klíč chrání administraci, operátorský průkaz je pouze evidenční údaj. Operátorské API je přístupné bez přihlášení. Před internetovým nasazením je nutná autentizace uživatelů a zařízení, oprávnění, HTTPS, izolace firem, zálohy a správa tajných údajů. Původní API nemá autentizaci.

Rozklad šarže a data výroby vyžaduje reálné příklady kódů a specifikaci formátu. Zatím se ukládá celý obsah skenu do historie; nepředpokládá se GS1 ani jiný neověřený formát. Offline práce a přiřazení projektu stanici administrátorem jsou další rozšíření.
