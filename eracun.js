//Priprava knjižnic
var formidable = require("formidable");
var util = require('util');

if (!process.env.PORT)
  process.env.PORT = 8080;

// Priprava povezave na podatkovno bazo
var sqlite3 = require("sqlite3").verbose();
var pb = new sqlite3.Database("Chinook.sl3");

// Priprava strežnika
var express = require('express');
var expressSession = require('express-session');
var streznik = express();
streznik.set('view engine', 'ejs');
streznik.use(express.static('public'));
streznik.use(
  expressSession({
    secret: '1234567890QWERTY', // Skrivni ključ za podpisovanje piškotkov
    saveUninitialized: true,    // Novo sejo shranimo
    resave: false,              // Ne zahtevamo ponovnega shranjevanja
    cookie: {
      maxAge: 3600000           // Seja poteče po 60 min neaktivnosti
    }
  })
);

var razmerje_USD_EUR = 0.89;

// Izračun davčne stopnje glede na izvajalca in žanr
function davcnaStopnja(izvajalec, zanr) {
  switch (izvajalec) {
    case "Queen":
    case "Led Zepplin":
    case "Kiss":
      return 0;
    case "Justin Bieber":
      return 22;
    default:
      break;
  }
  switch (zanr) {
    case "Metal":
    case "Heavy Metal":
    case "Easy Listening":
      return 0;
    default:
      return 9.5;
  }
}

// Vrne naziv stranke (ime ter priimek) glede na ID stranke
function vrniNazivStranke(strankaId, povratniKlic) {
  pb.all(
    "SELECT Customer.FirstName  || ' ' || Customer.LastName AS naziv \
    FROM    Customer \
    WHERE   Customer.CustomerId = " + strankaId, 
    {}, 
    function (napaka, vrstica) {
      if (napaka) {
        povratniKlic("");
      } else {
        povratniKlic(vrstica.length > 0 ? vrstica[0].naziv : "");
      }
    }
  );
}

// Prikaz seznama pesmi na strani
streznik.get("/", function(zahteva, odgovor) {
  pb.all(
    "SELECT   Track.TrackId AS id, \
              Track.Name AS pesem, \
              Artist.Name AS izvajalec, \
              Track.UnitPrice * " + razmerje_USD_EUR + " AS cena, \
              COUNT(InvoiceLine.InvoiceId) AS steviloProdaj, \
              Genre.Name AS zanr \
    FROM      Track, Album, Artist, InvoiceLine, Genre \
    WHERE     Track.AlbumId = Album.AlbumId AND \
              Artist.ArtistId = Album.ArtistId AND \
              InvoiceLine.TrackId = Track.TrackId AND \
              Track.GenreId = Genre.GenreId \
    GROUP BY  Track.TrackId \
    ORDER BY  steviloProdaj DESC, pesem ASC \
    LIMIT     100",
    function(napaka, vrstice) {
      if (napaka) {
        odgovor.sendStatus(500);
      } else {
        for (var i=0; i < vrstice.length; i++) {
          vrstice[i].stopnja = davcnaStopnja(
            vrstice[i].izvajalec,
            vrstice[i].zanr
          );
        }
        vrniNazivStranke(
          zahteva.session.trenutnaStranka, 
          function(nazivOdgovor) {
            odgovor.render("seznam", {
              seznamPesmi: vrstice,
              nazivStranke: nazivOdgovor
            });
          }
        );
      }
    }
  );
});

// Dodajanje oz. brisanje pesmi iz košarice
streznik.get("/kosarica/:idPesmi", function(zahteva, odgovor) {
  var idPesmi = parseInt(zahteva.params.idPesmi, 10);
  if (!zahteva.session.kosarica) {
    zahteva.session.kosarica = [];
  }
  // Če je pesem v košarici, jo izbrišemo
  if (zahteva.session.kosarica.indexOf(idPesmi) > -1) {
    zahteva.session.kosarica.splice(zahteva.session.kosarica.indexOf(idPesmi), 1);
  // Če pesmi ni v košarici, jo dodamo
  } else {
    zahteva.session.kosarica.push(idPesmi);
  }
  // V odgovoru vrnemo vsebino celotne košarice
  odgovor.send(zahteva.session.kosarica);
});

// Vrni podrobnosti pesmi v košarici iz podatkovne baze
var pesmiIzKosarice = function(zahteva, povratniKlic) {
  // Če je košarica prazna
  if (!zahteva.session.kosarica || zahteva.session.kosarica.length == 0) {
    povratniKlic([]);
  } else {
    pb.all(
      "SELECT Track.TrackId AS stevilkaArtikla, \
              1 AS kolicina, \
              Track.Name || ' (' || Artist.Name || ')' AS opisArtikla, \
              Track.UnitPrice * " + razmerje_USD_EUR + " AS cena, \
              Genre.Name AS zanr, \
              0 AS popust \
      FROM    Track, Album, Artist, Genre \
      WHERE   Track.AlbumId = Album.AlbumId AND \
              Artist.ArtistId = Album.ArtistId AND \
              Track.GenreId = Genre.GenreId AND \
              Track.TrackId IN (" + zahteva.session.kosarica.join(",") + ")",
      function(napaka, vrstice) {
        if (napaka) {
          povratniKlic(false);
        } else {
          for (var i=0; i < vrstice.length; i++) {
            vrstice[i].stopnja = davcnaStopnja(
              (vrstice[i].opisArtikla.split(" (")[1]).split(")")[0],
              vrstice[i].zanr
            );
          }
          povratniKlic(vrstice);
        }
      }
    );
  }
};

// Vrni podrobnosti pesmi v košarici iz trenutne seje vključno s časom izvajanja
streznik.get("/podrobnosti", function(zahteva, odgovor) {
    var pesmi = zahteva.session.kosarica ? zahteva.session.kosarica.length : 0;
    var cas = casIzvajanjaKosarice(zahteva, function() { return cas; });
});

// Vrni čas izvajanja pesmi v košarici iz podatkovne baze
var casIzvajanjaKosarice = function(zahteva, povratniKlic) {
  if (!zahteva.session.kosarica || zahteva.session.kosarica.length == 0) {
    povratniKlic(0);
  } else {
    pb.get(
      "SELECT SUM(Milliseconds) / 60000 AS cas \
      FROM    Track \
      WHERE   Track.TrackId IN (" + zahteva.session.kosarica.join(",") + ")", 
      function (napaka, vrstica) {
        if (napaka) {
          povratniKlic(false);
        } else {
          povratniKlic(Math.round(vrstica.cas));
        }
      }
    );
  }
};

streznik.get("/kosarica", function(zahteva, odgovor) {
  pesmiIzKosarice(zahteva, function(pesmi) {
    if (!pesmi)
      odgovor.sendStatus(500);
    else
      odgovor.send(pesmi);
  });
});

// Vrni podrobnosti pesmi na računu
var pesmiIzRacuna = function(racunId, povratniKlic) {
  pb.all(
    "SELECT Track.TrackId AS stevilkaArtikla, \
            1 AS kolicina, \
            Track.Name || ' (' || Artist.Name || ')' AS opisArtikla, \
            Track.UnitPrice * " + razmerje_USD_EUR + " AS cena, \
            0 AS popust, \
            Genre.Name AS zanr \
    FROM    Track, Album, Artist, Genre \
    WHERE   Track.AlbumId = Album.AlbumId AND \
            Artist.ArtistId = Album.ArtistId AND \
            Track.GenreId = Genre.GenreId AND \
            Track.TrackId IN (\
              SELECT  InvoiceLine.TrackId \
              FROM    InvoiceLine, Invoice \
              WHERE   InvoiceLine.InvoiceId = Invoice.InvoiceId AND \
                      Invoice.InvoiceId = " + racunId + 
            ")",
    function(napaka, vrstice) {
      console.log(vrstice);
    });
};

// Vrni podrobnosti o stranki iz računa
var strankaIzRacuna = function(racunId, callback) {
  pb.all(
    "SELECT Customer.* \
    FROM    Customer, Invoice \
    WHERE   Customer.CustomerId = Invoice.CustomerId AND \
            Invoice.InvoiceId = " + racunId,
    function(napaka, vrstice) {
      console.log(vrstice);
    });
};

// Izpis računa v HTML predstavitvi na podlagi podatkov iz baze
streznik.post("/izpisiRacunBaza", function(zahteva, odgovor) {
  var form = new formidable.IncomingForm();

  odgovor.end();
});

var stranka = function(strankaId, povratniKlic) {
  pb.get(
    "SELECT Customer.* \
    FROM    Customer \
    WHERE   Customer.CustomerId = $cid", 
    {},
    function(napaka, vrstica) {
      povratniKlic(false);
    });
};

// Izpis računa v HTML predstavitvi ali izvorni XML obliki
streznik.get("/izpisiRacun/:oblika", function(zahteva, odgovor) {
  pesmiIzKosarice(zahteva, function(pesmi) {
    if (!pesmi) {
      odgovor.sendStatus(500);
    } else if (pesmi.length == 0) {
      odgovor.send(
        "<p>V košarici nimate nobene pesmi, \
        zato računa ni mogoče pripraviti!</p>"
      );
    } else {
      odgovor.setHeader("Content-Type", "text/xml");
      odgovor.render(
        "eslog",
        {
          vizualiziraj: zahteva.params.oblika == "html",
          postavkeRacuna: pesmi
        }
      );
    }
  });
});

// Privzeto izpiši račun v HTML obliki
streznik.get("/izpisiRacun", function(zahteva, odgovor) {
  odgovor.redirect("/izpisiRacun/html");
});

// Vrni stranke iz podatkovne baze
var vrniStranke = function(povratniKlic) {
  pb.all("SELECT * FROM Customer",
    function (napaka, vrstice) {
      povratniKlic(napaka, vrstice);
    }
  );
};

// Vrni račune iz podatkovne baze
var vrniRacune = function(povratniKlic) {
  pb.all(
    "SELECT Customer.FirstName || ' ' || Customer.LastName || \
            ' (' || Invoice.InvoiceId || ') - ' || \
            date(Invoice.InvoiceDate) AS Naziv, \
            Invoice.InvoiceId \
    FROM    Customer, Invoice \
    WHERE   Customer.CustomerId = Invoice.CustomerId",
    function (napaka, vrstice) {
      povratniKlic(napaka, vrstice);
    }
  );
};
/*function poljaOk(polja) {
  for(var key of Object.keys(polja)) {
    if(polja [key].trim().length ==0) {
      return false;
    }
  }
  return true;
}*/
function IsEmpty(){ 

     if(document.form.question.value == "") {
           alert("empty");
     }
     return true;
  
}
// Registracija novega uporabnika
streznik.post("/prijava", function(zahteva, odgovor) {
  var form = new formidable.IncomingForm();

  form.parse(zahteva, function (napaka, polja, datoteke) {
     var kul= "Stranka" + " " + polja.FirstName + " " + polja.LastName + " " + "je bila uspešno dodana.";
     var nekul= "Prišlo je do napake pri dodajanju nove stranke. Prosim preverite vnesene podatke in poskusite znova.";
      if (napaka || !IsEmpty()) {
      vrniStranke(function(napaka, stranke) {
        vrniRacune(function(napaka, racuni) {
          odgovor.render('prijava', {sporocilo: nekul, seznamStrank: stranke, seznamRacunov: racuni});  
        });
      });
    } else {
    pb.run(
      "INSERT INTO Customer (FirstName, LastName, Company, \
                            Address, City, State, Country, PostalCode, \
                            Phone, Fax, Email, SupportRepId) \
      VALUES  ($fn, $ln, $com, $addr, $city, $state, $country, $pc, $phone, \
              $fax, $email, $sri)",
              {$fn: polja ["FirstName"], $ln:polja ["LastName"], $com: polja ["Company"], $addr:polja ["Address"],
	            $city: polja["City"], $state: polja ["State"], $country: polja ["Country"], $pc: polja ["PostalCode"],
	            $phone: polja ["Phone"], $fax: polja ["Fax"], $email: polja ["Email"], $sri:9},
      {}, 
      function(napaka) {
        var spor=napaka ? nekul : kul;
        vrniStranke(function(napaka1, stranke) {
          vrniRacune(function(napaka2, racuni) {
            odgovor.render(
              "prijava", 
              {
                sporocilo: spor, 
                seznamStrank: stranke, 
                seznamRacunov: racuni
              }
            );
          });
        });
      });
    }
  });
});

function prestejRacuneZaStranko(stranka, racuni) {
  var stevec = 0;
  for (var i = 0; i < racuni.length; i++) {
    if (racuni[i].Naziv.startsWith(stranka.FirstName + " " + stranka.LastName)) {
      stevec++;
    }
  }
  
  return stevec;
}

// Prikaz strani za prijavo
streznik.get("/prijava", function(zahteva, odgovor) {
  vrniStranke(function (napaka1, stranke) {
    vrniRacune(function (napaka2, racuni) {
      for (var i=0; i < stranke.length; i++) {
        stranke[i].StRacunov = prestejRacuneZaStranko(stranke[i], racuni);
      }
      odgovor.render(
        "prijava", 
        {
          sporocilo: "", 
          seznamStrank: stranke, 
          seznamRacunov: racuni
        }
      );
    });
  });
});

// Prikaz nakupovalne košarice za stranko
streznik.post("/stranka", function (zahteva, odgovor) {
  var form = new formidable.IncomingForm();
  form.parse(zahteva, function (napaka1, polja, datoteke) {
    zahteva.session.trenutnaStranka = parseInt(polja["seznamStrank"], 10);
    odgovor.redirect("/");
  });
});

// Odjava stranke
streznik.post("/odjava", function (zahteva, odgovor) {
  delete zahteva.session.trenutnaStranka;
  delete zahteva.session.kosarica;
  odgovor.redirect("/prijava");
});

streznik.listen(process.env.PORT, function() {
  console.log("Strežnik je pognan!");
});